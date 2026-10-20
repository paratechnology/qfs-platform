<?php

namespace Tests\Feature;

use App\Support\SessionAuth;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class MoneyFlowTest extends TestCase
{
    private string $userId = 'user-1';

    private string $adminId = 'admin-1';

    private string $userToken;

    private string $adminToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withCredentials();
        config()->set('qfs.session_secret', str_repeat('x', 64));
        Schema::create('User', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('email');
            $t->string('name');
            $t->string('locale')->default('en');
            $t->string('phone')->nullable();
            $t->string('passwordHash')->default('');
            $t->string('role')->default('USER');
            $t->string('status')->default('ACTIVE');
            $t->string('country')->default('United States');
            $t->string('avatarUrl')->default('/avatars/avatar1.jpg');
            $t->string('referralCode')->default('TEST');
            $t->string('referredById')->nullable();
            $t->integer('kycLevel')->default(0);
            $t->timestamp('memberSince')->useCurrent();
            $t->timestamp('lastLoginAt')->nullable();
            $t->timestamp('createdAt')->useCurrent();
            $t->timestamp('updatedAt')->useCurrent();
        });
        Schema::create('Account', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->integer('balanceCents')->default(0);
            $t->integer('availableCents')->default(0);
            $t->timestamp('updatedAt')->useCurrent();
        });
        Schema::create('Session', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('tokenHash');
            $t->timestamp('expiresAt');
            $t->timestamp('createdAt')->useCurrent();
        });
        (require database_path('migrations/2026_10_16_220933_add_account_security.php'))->up();
        foreach (['DepositRequest', 'WithdrawalRequest'] as $name) {
            Schema::create($name, function (Blueprint $t) use ($name) {
                $t->string('id')->primary();
                $t->string('userId');
                $t->integer('amountCents');
                $t->string('method');
                $t->string('reference')->unique();
                $t->string('status')->default('PENDING');
                $t->string('walletAddress')->nullable();
                $t->string('reviewedById')->nullable();
                $t->timestamp('reviewedAt')->nullable();
                $t->string('adminNote')->nullable();
                $t->string('transactionId')->nullable();
                $t->timestamp('createdAt')->useCurrent();
                if ($name === 'WithdrawalRequest') {
                    $t->string('details')->nullable();
                }
            });
        }
        Schema::create('Transaction', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('type');
            $t->integer('amountCents');
            $t->string('method')->nullable();
            $t->string('reference')->unique();
            $t->string('status')->default('COMPLETED');
            $t->string('note')->nullable();
            $t->string('meta')->nullable();
            $t->timestamp('completedAt')->nullable();
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('LedgerEntry', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('accountId');
            $t->string('movement');
            $t->integer('amountCents');
            $t->integer('balanceAfterCents');
            $t->string('txId')->nullable();
            $t->string('note')->nullable();
        });
        Schema::create('Setting', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('key');
            $t->string('value');
        });
        Schema::create('Card', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('status')->default('ACTIVE');
            $t->boolean('isDefault')->default(false);
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('Notification', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('title');
            $t->string('body')->nullable();
            $t->text('messageParams')->nullable();
        });
        Schema::create('AuditLog', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('actorId');
            $t->string('actorRole');
            $t->string('action');
            $t->string('targetType');
            $t->string('targetId')->nullable();
            $t->string('meta')->nullable();
        });
        DB::table('User')->insert([
            ['id' => $this->userId, 'email' => 'user@test.local', 'name' => 'User', 'role' => 'USER'],
            ['id' => $this->adminId, 'email' => 'admin@test.local', 'name' => 'Admin', 'role' => 'ADMIN'],
        ]);
        DB::table('Account')->insert(['id' => 'account-1', 'userId' => $this->userId,
            'balanceCents' => 10000, 'availableCents' => 10000]);
        $this->userToken = SessionAuth::issue($this->userId);
        $this->adminToken = SessionAuth::issue($this->adminId);
    }

    public function test_promoting_a_user_revokes_existing_sessions(): void
    {
        $this->assertSame(1, DB::table('Session')->where('userId', $this->userId)->count());
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/users/'.$this->userId, ['action' => 'SET_ROLE', 'role' => 'ADMIN'])
            ->assertOk()->assertJsonPath('data.role', 'ADMIN');
        $this->assertSame(0, DB::table('Session')->where('userId', $this->userId)->count());
        $this->assertSame(1, DB::table('AuditLog')->where('targetId', $this->userId)
            ->where('action', 'USER.SET_ROLE')->count());
    }

    public function test_withdrawal_reserves_funds_and_approval_only_debits_total_balance(): void
    {
        $created = $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->postJson('/api/withdrawals', ['amount' => 70, 'method' => 'Bank Transfer', 'reference' => 'WD-test-1']);
        $created->assertOk()->assertJsonPath('data.created', true);
        $id = $created->json('data.request.id');
        $this->assertSame(3000, DB::table('Account')->where('id', 'account-1')->value('availableCents'));

        $approved = $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/requests/'.$id.'?type=WITHDRAWAL', ['action' => 'APPROVE']);
        $approved->assertOk()->assertJsonPath('data.status', 'APPROVED');
        $account = DB::table('Account')->where('id', 'account-1')->first();
        $this->assertSame(3000, $account->balanceCents);
        $this->assertSame(3000, $account->availableCents);
        $this->assertSame(1, DB::table('Transaction')->where('type', 'WITHDRAWAL')->count());

        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/requests/'.$id.'?type=WITHDRAWAL', ['action' => 'APPROVE'])
            ->assertOk()->assertJsonPath('data.alreadyReviewed', true);
        $this->assertSame(1, DB::table('Transaction')->where('type', 'WITHDRAWAL')->count());
    }

    public function test_registration_records_a_welcome_message_without_auto_login(): void
    {
        $this->postJson('/api/auth/register', [
            'firstName' => 'Example', 'lastName' => 'Member', 'email' => 'new@example.test',
            'password' => 'ExampleSecure94', 'confirmPassword' => 'ExampleSecure94', 'phone' => '+2348000000000',
        ])->assertOk()->assertJsonPath('data.registered', true);
        $id = DB::table('User')->where('email', 'new@example.test')->value('id');
        $this->assertSame(0, DB::table('Session')->where('userId', $id)->count());
        $this->assertSame('Account registration successful.', DB::table('Notification')->where('userId', $id)->value('title'));
    }

    public function test_rejected_withdrawal_releases_reservation(): void
    {
        $id = $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->postJson('/api/withdrawals', ['amount' => 30, 'method' => 'Bank Transfer', 'reference' => 'WD-test-2'])
            ->json('data.request.id');
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/requests/'.$id.'?type=WITHDRAWAL', ['action' => 'REJECT'])
            ->assertOk();
        $account = DB::table('Account')->where('id', 'account-1')->first();
        $this->assertSame(10000, $account->balanceCents);
        $this->assertSame(10000, $account->availableCents);
    }

    public function test_deposit_approval_is_single_use_and_creates_a_ledger_entry(): void
    {
        $id = $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->postJson('/api/deposits', ['amount' => 20, 'method' => 'Bank Transfer', 'reference' => 'DEP-test-1'])
            ->json('data.request.id');
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/requests/'.$id, ['action' => 'APPROVE'])->assertOk();
        $account = DB::table('Account')->where('id', 'account-1')->first();
        $this->assertSame(12000, $account->balanceCents);
        $this->assertSame(12000, $account->availableCents);
        $this->assertSame(1, DB::table('Transaction')->where('type', 'DEPOSIT')->count());
        $this->assertSame(1, DB::table('LedgerEntry')->where('txId', '!=', null)->count());
    }

    public function test_withdrawal_history_includes_pending_requests_and_is_private(): void
    {
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->postJson('/api/withdrawals', ['amount' => 30, 'method' => 'Bank Transfer', 'reference' => 'WD-pending'])
            ->assertOk();
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->getJson('/api/withdrawals')
            ->assertOk()
            ->assertJsonPath('data.items.0.status', 'PENDING')
            ->assertJsonPath('data.items.0.reference', 'WD-pending');
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->getJson('/api/withdrawals')
            ->assertOk()
            ->assertJsonCount(0, 'data.items');
    }

    public function test_transaction_lookup_returns_only_the_owners_record(): void
    {
        DB::table('Transaction')->insert([
            'id' => 'tx-user', 'userId' => $this->userId, 'type' => 'DEPOSIT',
            'amountCents' => 2500, 'reference' => 'DEP-owner-only',
        ]);
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->getJson('/api/transactions?id=tx-user')
            ->assertOk()
            ->assertJsonPath('data.items.0.id', 'tx-user');
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->getJson('/api/transactions?id=tx-user')
            ->assertOk()
            ->assertJsonCount(0, 'data.items');
    }

    public function test_registration_creates_an_account_but_requires_explicit_login(): void
    {
        $response = $this->withUnencryptedCookie('qfs_session', $this->userToken)->postJson('/api/auth/register', [
            'firstName' => 'New', 'lastName' => 'Member', 'email' => 'NEW@example.test',
            'password' => 'Password1234', 'confirmPassword' => 'Password1234',
            'country' => 'Nigeria', 'phone' => '+2348012345678',
        ]);
        $response->assertOk()->assertJsonPath('data.registered', true)->assertJsonPath('data.user.email', 'new@example.test');
        $id = $response->json('data.user.id');
        $this->assertSame(1, DB::table('Account')->where('userId', $id)->count());
        $cookie = collect($response->headers->getCookies())->first(fn ($c) => $c->getName() === 'qfs_session');
        $this->assertNotNull($cookie);
        $this->assertSame('', $cookie->getValue());
        $this->assertSame(0, DB::table('Session')->where('userId', $id)->count());
        $this->assertSame(0, DB::table('Session')->where('userId', $this->userId)->count());
        $this->getJson('/api/auth/me')->assertUnauthorized();
        $login = $this->postJson('/api/auth/login', ['email' => 'new@example.test', 'password' => 'Password1234'])->assertOk();
        $token = collect($login->headers->getCookies())->first(fn ($c) => $c->getName() === 'qfs_session')->getValue();
        $this->withUnencryptedCookie('qfs_session', $token)->getJson('/api/auth/me')->assertOk()->assertJsonPath('data.id', $id);
    }

    public function test_card_owner_can_freeze_and_unfreeze_their_card(): void
    {
        DB::table('Card')->insert(['id' => 'card-1', 'userId' => $this->userId]);
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->patchJson('/api/cards/card-1', ['action' => 'FREEZE'])
            ->assertOk()->assertJsonPath('data.status', 'FROZEN');
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->patchJson('/api/cards/card-1', ['action' => 'UNFREEZE'])
            ->assertOk()->assertJsonPath('data.status', 'ACTIVE');
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/cards/card-1', ['action' => 'FREEZE'])->assertStatus(404);
    }

    public function test_admin_can_filter_deposits_withdrawals_and_loans_for_one_account(): void
    {
        foreach (['DepositRequest', 'WithdrawalRequest'] as $table) {
            foreach ([$this->userId, $this->adminId] as $userId) {
                DB::table($table)->insert(['id' => $table.'-'.$userId, 'userId' => $userId,
                    'amountCents' => 10000, 'method' => 'Bank', 'reference' => $table.'-'.$userId]);
            }
        }
        Schema::create('Loan', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('type')->default('Personal');
            $table->string('currency')->default('USD');
            $table->integer('amountCents')->default(10000);
            $table->integer('period')->default(12);
            $table->string('status')->default('PENDING');
            $table->string('adminNote')->nullable();
            $table->timestamp('createdAt')->useCurrent();
        });
        foreach ([$this->userId, $this->adminId] as $userId) {
            DB::table('Loan')->insert(['id' => 'loan-'.$userId, 'userId' => $userId]);
        }
        foreach (['requests?type=DEPOSIT&', 'requests?type=WITHDRAWAL&', 'loans?'] as $path) {
            $this->withUnencryptedCookie('qfs_session', $this->adminToken)
                ->getJson('/api/admin/'.$path.'userId='.$this->userId)->assertOk()
                ->assertJsonPath('data.total', 1)->assertJsonCount(1, 'data.items')
                ->assertJsonPath('data.items.0.userEmail', 'user@test.local');
        }
    }

    public function test_regular_users_cannot_review_requests_loans_or_change_accounts_and_balances(): void
    {
        foreach (['/api/admin/requests/missing?type=DEPOSIT', '/api/admin/requests/missing?type=WITHDRAWAL', '/api/admin/loans/missing', '/api/admin/users/'.$this->adminId] as $path) {
            $this->withUnencryptedCookie('qfs_session', $this->userToken)->patchJson($path, ['action' => 'APPROVE'])->assertForbidden();
        }
        $this->postJson('/api/admin/adjustments', ['scope' => 'USER', 'userId' => $this->userId, 'direction' => 'CREDIT', 'amount' => 100, 'note' => 'Unauthorized adjustment'])->assertForbidden();
        $this->assertSame(10000, DB::table('Account')->where('userId', $this->userId)->value('balanceCents'));
        $this->assertSame(0, DB::table('AuditLog')->count());
    }
}
