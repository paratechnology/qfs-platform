<?php

namespace Tests\Feature;

use App\Support\CryptoFunds;
use App\Support\Qfs;
use App\Support\SessionAuth;
use Carbon\CarbonImmutable;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\Process\Process;
use Tests\TestCase;

class DatabaseIntegrationTest extends TestCase
{
    private ?string $sqliteFile = null;

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::getDriverName() === 'sqlite' && DB::connection()->getDatabaseName() === ':memory:') {
            $this->sqliteFile = sys_get_temp_dir().'/qfs-'.bin2hex(random_bytes(8)).'_test.sqlite';
            touch($this->sqliteFile);
            config()->set('database.connections.sqlite.database', $this->sqliteFile);
            DB::purge('sqlite');
        }
        $database = DB::connection()->getDatabaseName();
        $isolated = DB::getDriverName() === 'sqlite'
            ? str_ends_with($database, '_test.sqlite')
            : str_ends_with($database, '_test');
        if (! app()->environment('testing') || ! $isolated) {
            throw new \RuntimeException('Integration tests require an isolated *_test database or *_test.sqlite file.');
        }
        $this->withCredentials();
        config()->set('qfs.session_secret', str_repeat('x', 64));
        config()->set('qfs.account_emails', false);
        Bus::fake();
        Http::preventStrayRequests();
        Artisan::call('migrate:fresh', ['--force' => true]);
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        if ($this->sqliteFile !== null) {
            DB::disconnect('sqlite');
        }
        parent::tearDown();
        if ($this->sqliteFile !== null) {
            foreach ([$this->sqliteFile, $this->sqliteFile.'-wal', $this->sqliteFile.'-shm'] as $file) {
                if (file_exists($file)) {
                    unlink($file);
                }
            }
        }
    }

    private function member(string $id, string $role = 'USER', int $balance = 10000): string
    {
        DB::table('User')->insert(['id' => $id, 'name' => 'Example '.$id, 'email' => $id.'@example.test',
            'passwordHash' => password_hash('Isolated-test-password-01', PASSWORD_BCRYPT), 'role' => $role,
            'referralCode' => 'REF-'.$id, 'updatedAt' => Qfs::now()]);
        DB::table('Account')->insert(['id' => 'account-'.$id, 'userId' => $id, 'balanceCents' => $balance,
            'availableCents' => $balance, 'updatedAt' => Qfs::now()]);

        return SessionAuth::issue($id);
    }

    public function test_full_migration_chain_is_repeatable_and_preserves_atomic_precision_and_case(): void
    {
        $this->assertSame(0, Artisan::call('migrate', ['--force' => true]));
        $this->member('member');
        DB::transaction(function () {
            $balance = CryptoFunds::balance('member', 'ETH');
            CryptoFunds::move($balance, str_repeat('9', 78), '0', 'DEPOSIT', str_repeat('9', 78), 'EXACT-78-DIGITS');
        });
        $this->assertSame(str_repeat('9', 78), DB::table('CryptoBalance')->value('totalAtomic'));
        $this->assertSame(str_repeat('9', 78), DB::table('CryptoLedger')->value('quantityAtomic'));
        foreach (['CaseSensitiveAddress', 'casesensitiveaddress'] as $i => $address) {
            DB::table('ReceivingWallet')->insert(['id' => 'wallet-'.$i, 'assetKey' => 'SOL', 'label' => 'Solana', 'address' => $address]);
        }
        $this->assertSame(2, DB::table('ReceivingWallet')->count());
        DB::table('Transaction')->insert(['id' => 'transaction', 'userId' => 'member', 'type' => 'DEPOSIT', 'amountCents' => 100, 'reference' => 'FK-REBUILD']);
        DB::table('LedgerEntry')->insert(['id' => 'ledger', 'accountId' => 'account-member', 'movement' => 'CREDIT', 'amountCents' => 100, 'balanceAfterCents' => 10100, 'txId' => 'transaction']);
        Schema::table('LedgerEntry', fn (Blueprint $table) => $table->text('note')->nullable()->change());
        $this->assertSame('transaction', DB::table('LedgerEntry')->value('txId'));
        DB::table('Transaction')->where('id', 'transaction')->delete();
        $this->assertNull(DB::table('LedgerEntry')->value('txId'));

        $this->expectException(UniqueConstraintViolationException::class);
        DB::table('ReceivingWallet')->insert(['id' => 'duplicate', 'assetKey' => 'SOL', 'label' => 'Solana', 'address' => 'CaseSensitiveAddress']);
    }

    public function test_search_remains_case_insensitive_and_escapes_wildcards_on_binary_collation(): void
    {
        $token = $this->member('admin', 'ADMIN');
        $this->member('member');
        DB::table('User')->where('id', 'member')->update(['name' => 'UpperCASE 100%_Literal']);
        $this->withUnencryptedCookie('qfs_session', $token)->getJson('/api/admin/users?search=uppercase')->assertOk()->assertJsonFragment(['name' => 'UpperCASE 100%_Literal']);
        $this->getJson('/api/admin/users?search='.urlencode('100%_'))->assertOk()->assertJsonFragment(['name' => 'UpperCASE 100%_Literal']);
        $this->getJson('/api/search?q=DEPOSIT')->assertOk();
        DB::table('KycSubmission')->insert(['id' => 'kyc', 'userId' => 'member', 'status' => 'PENDING', 'submittedAt' => Qfs::now()]);
        $this->getJson('/api/admin/kyc?search=uppercase')->assertOk()->assertJsonFragment(['id' => 'kyc']);
    }

    public function test_sqlite_retries_a_stale_snapshot_before_recalculating_the_balance(): void
    {
        if (DB::getDriverName() !== 'sqlite') {
            $this->markTestSkipped('SQLite WAL snapshot regression.');
        }
        $this->member('member');
        config()->set('database.connections.sqlite.transaction_mode', 'DEFERRED');
        DB::purge('sqlite');
        $otherWriter = new \PDO('sqlite:'.DB::connection()->getDatabaseName(), options: [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
        $attempts = 0;
        $notifications = 0;

        DB::transaction(function () use ($otherWriter, &$attempts, &$notifications): void {
            $attempts++;
            $balance = DB::table('Account')->where('userId', 'member')->value('availableCents');
            DB::afterCommit(function () use (&$notifications): void {
                $notifications++;
            });
            if ($attempts === 1) {
                $otherWriter->exec('UPDATE "Account" SET "availableCents" = "availableCents" + 100');
            }
            DB::table('Account')->where('userId', 'member')->update(['availableCents' => $balance + 1000]);
        });

        $this->assertSame(2, $attempts);
        $this->assertSame(11100, DB::table('Account')->value('availableCents'));
        $this->assertSame(1, $notifications);
        $this->assertSame(0, DB::transactionLevel());
        $this->assertFalse(DB::getPdo()->inTransaction());
    }

    public function test_nested_transactions_and_business_failures_roll_back_without_retrying(): void
    {
        $this->member('member');
        DB::beginTransaction();
        DB::table('Account')->update(['availableCents' => 9000]);
        DB::beginTransaction();
        DB::table('Account')->update(['availableCents' => 8000]);
        DB::rollBack();
        $this->assertSame(9000, DB::table('Account')->value('availableCents'));
        DB::commit();

        $attempts = 0;
        try {
            DB::transaction(function () use (&$attempts): void {
                $attempts++;
                DB::table('Account')->update(['availableCents' => 5000]);
                throw new \RuntimeException('Business validation failed');
            });
            $this->fail('The business failure must propagate.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Business validation failed', $e->getMessage());
        }

        $this->assertSame(1, $attempts);
        $this->assertSame(9000, DB::table('Account')->value('availableCents'));
        $this->assertSame(0, DB::transactionLevel());
        $this->assertFalse(DB::getPdo()->inTransaction());
    }

    public function test_complete_financial_flow_retains_reservations_and_recorded_plan_terms(): void
    {
        $member = $this->member('member');
        $admin = $this->member('admin', 'ADMIN');
        $deposit = $this->withUnencryptedCookie('qfs_session', $member)->postJson('/api/deposits', ['amount' => 100, 'method' => 'Bank Transfer', 'reference' => 'DEP-MYSQL'])->assertOk()->json('data.request.id');
        $this->withUnencryptedCookie('qfs_session', $admin)->patchJson('/api/admin/requests/'.$deposit.'?type=DEPOSIT', ['action' => 'APPROVE'])->assertOk();
        $this->patchJson('/api/admin/requests/'.$deposit.'?type=DEPOSIT', ['action' => 'APPROVE'])->assertOk();
        $this->assertSame(20000, DB::table('Account')->where('userId', 'member')->value('availableCents'));
        $withdrawal = $this->withUnencryptedCookie('qfs_session', $member)->postJson('/api/withdrawals', ['amount' => 50, 'method' => 'Bank Transfer', 'reference' => 'WD-MYSQL'])->assertOk()->json('data.request.id');
        $this->assertSame(15000, DB::table('Account')->where('userId', 'member')->value('availableCents'));
        $this->withUnencryptedCookie('qfs_session', $admin)->patchJson('/api/admin/requests/'.$withdrawal.'?type=WITHDRAWAL', ['action' => 'REJECT'])->assertOk();
        $this->assertSame(20000, DB::table('Account')->where('userId', 'member')->value('availableCents'));
        DB::table('InvestmentPlan')->insert(['id' => 'plan', 'name' => 'Fixture plan', 'minAmountCents' => 10000, 'monthlyRoiBps' => 1000,
            'termMonths' => 3, 'payoutInterval' => 'HOURLY', 'terms' => str_repeat('Terms ', 2000), 'updatedAt' => Qfs::now()]);
        $this->withUnencryptedCookie('qfs_session', $member)->postJson('/api/investments', ['amount' => 100, 'planId' => 'plan', 'reference' => 'INV-MYSQL'])->assertOk();
        $this->assertSame(10000, DB::table('Account')->where('userId', 'member')->value('availableCents'));
        $this->assertSame(1000, DB::table('Investment')->value('monthlyRoiBps'));
        $this->assertStringContainsString('Terms', DB::table('Investment')->value('materials'));
    }

    /** Start independent writers together to exercise each engine's actual locking. */
    private function race(array $jobs): array
    {
        $barrier = tempnam(sys_get_temp_dir(), 'qfs-race-');
        unlink($barrier);
        $connection = DB::connection()->getConfig();
        $environment = ['APP_ENV' => 'testing', 'DB_CONNECTION' => DB::getDriverName(), 'DB_HOST' => ($connection['host'] ?? ''),
            'DB_PORT' => (string) ($connection['port'] ?? ''), 'DB_DATABASE' => $connection['database'], 'DB_USERNAME' => ($connection['username'] ?? ''),
            'DB_PASSWORD' => ($connection['password'] ?? ''), 'DB_URL' => '', 'QFS_SESSION_SECRET' => str_repeat('x', 64),
            'QFS_ACCOUNT_EMAILS' => 'false', 'CACHE_STORE' => 'array', 'QFS_TEST_BARRIER' => $barrier];
        $script = <<<'PHP'
require 'vendor/autoload.php';
$app = require 'bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (! app()->environment('testing') || ! preg_match('/_test(?:\.sqlite)?$/', Illuminate\Support\Facades\DB::connection()->getDatabaseName())) throw new RuntimeException('Test database required');
$job = json_decode(getenv('QFS_TEST_JOB'), true, 512, JSON_THROW_ON_ERROR);
echo "READY\n";
while (! file_exists(getenv('QFS_TEST_BARRIER'))) usleep(20000);
try {
    if ($job['kind'] === 'earnings') {
        Carbon\CarbonImmutable::setTestNow('2026-10-22 04:00:00 UTC');
        App\Support\Earnings::forUser('member');
        $status = 200;
    } else {
        $request = Illuminate\Http\Request::create($job['path'], $job['method'], $job['body'], ['qfs_session' => $job['token']]);
        $controller = $job['kind'] === 'withdrawal' ? new App\Http\Controllers\MoneyController : new App\Http\Controllers\AdminActionController;
        $response = $job['kind'] === 'withdrawal' ? $controller->withdrawal($request) : $controller->request($request, 'deposit');
        $status = $response->getStatusCode();
    }
} catch (Illuminate\Http\Exceptions\HttpResponseException $e) {
    $status = $e->getResponse()->getStatusCode();
}
echo json_encode(['status' => $status], JSON_THROW_ON_ERROR);
PHP;
        $processes = [];
        try {
            foreach ($jobs as $job) {
                $process = new Process([PHP_BINARY, '-r', $script], base_path(), [...$environment, 'QFS_TEST_JOB' => json_encode($job, JSON_THROW_ON_ERROR)]);
                $process->setTimeout(30)->start();
                $processes[] = $process;
            }
            foreach ($processes as $process) {
                $process->waitUntil(fn ($type, $output) => str_contains($output, 'READY'));
            }
            touch($barrier);
            $statuses = [];
            foreach ($processes as $process) {
                $process->wait();
                $this->assertTrue($process->isSuccessful(), $process->getErrorOutput());
                $statuses[] = json_decode(substr($process->getOutput(), strpos($process->getOutput(), "\n") + 1), true, 512, JSON_THROW_ON_ERROR)['status'];
            }
            sort($statuses);

            return $statuses;
        } finally {
            foreach ($processes as $process) {
                if ($process->isRunning()) {
                    $process->stop();
                }
            }
            if (file_exists($barrier)) {
                unlink($barrier);
            }
        }
    }

    public function test_concurrent_withdrawals_cannot_spend_the_same_available_balance(): void
    {
        $token = $this->member('member');
        $jobs = [];
        foreach (['A', 'B'] as $suffix) {
            $jobs[] = ['kind' => 'withdrawal', 'method' => 'POST', 'path' => '/api/withdrawals', 'token' => $token,
                'body' => ['amount' => 80, 'method' => 'Bank Transfer', 'reference' => 'CONCURRENT-'.$suffix]];
        }
        $this->assertSame([200, 400], $this->race($jobs));
        $this->assertSame(2000, DB::table('Account')->value('availableCents'));
        $this->assertSame(1, DB::table('WithdrawalRequest')->count());
        $this->assertSame(1, DB::table('LedgerEntry')->count());
    }

    public function test_concurrent_deposit_approvals_credit_once_and_pay_one_referral_reward(): void
    {
        $token = $this->member('admin', 'ADMIN');
        $this->member('referrer');
        $this->member('member');
        DB::table('User')->where('id', 'member')->update(['referredById' => 'referrer']);
        DB::table('DepositRequest')->insert(['id' => 'deposit', 'userId' => 'member', 'amountCents' => 10000, 'method' => 'Bank Transfer', 'reference' => 'DEP-RACE']);
        $job = ['kind' => 'approval', 'method' => 'PATCH', 'path' => '/api/admin/requests/deposit?type=DEPOSIT', 'token' => $token, 'body' => ['action' => 'APPROVE']];
        $this->assertSame([200, 200], $this->race([$job, $job]));
        $this->assertSame(20000, DB::table('Account')->where('userId', 'member')->value('availableCents'));
        $this->assertSame(10500, DB::table('Account')->where('userId', 'referrer')->value('availableCents'));
        $this->assertSame(1, DB::table('ReferralEarning')->count());
        $this->assertSame(1, DB::table('Transaction')->where('type', 'DEPOSIT')->count());
    }

    public function test_concurrent_hourly_sweeps_do_not_duplicate_profit(): void
    {
        $this->member('member');
        DB::table('InvestmentPlan')->insert(['id' => 'plan', 'name' => 'Hourly fixture', 'minAmountCents' => 10000,
            'monthlyRoiBps' => 1000, 'termMonths' => 3, 'payoutInterval' => 'HOURLY', 'updatedAt' => Qfs::now()]);
        DB::table('Investment')->insert(['id' => 'investment', 'userId' => 'member', 'planId' => 'plan', 'amountCents' => 100000,
            'monthlyRoiBps' => 1000, 'termMonths' => 3, 'payoutInterval' => 'HOURLY', 'startDate' => '2026-10-22 00:00:00']);
        $this->assertSame([200, 200], $this->race([['kind' => 'earnings'], ['kind' => 'earnings']]));
        $paid = DB::table('Investment')->value('paidOutCents');
        $this->assertGreaterThan(0, $paid);
        $this->assertSame(10000 + $paid, DB::table('Account')->value('availableCents'));
        $this->assertSame(1, DB::table('Transaction')->where('type', 'EARNING')->count());
    }
}
