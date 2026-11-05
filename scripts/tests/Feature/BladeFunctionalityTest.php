<?php

namespace Tests\Feature;

use App\Http\Controllers\AdminController;
use App\Support\CryptoFunds;
use App\Support\Qfs;
use App\Support\Reviews;
use App\Support\SessionAuth;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class BladeFunctionalityTest extends TestCase
{
    private string $member;

    private string $admin;

    protected function setUp(): void
    {
        parent::setUp();
        if (! app()->environment('testing') || DB::connection()->getDatabaseName() !== ':memory:') {
            throw new \RuntimeException('A disposable in-memory test database is required.');
        }
        config()->set('qfs.session_secret', str_repeat('t', 64));
        config()->set('qfs.illustrative_reviews', false);
        config()->set('services.swaps.enabled', false);
        config()->set('qfs.account_emails', false);
        $this->withCredentials();
        $this->travelTo(now()->setDate(2026, 11, 4)->startOfDay());
        Artisan::call('migrate:fresh', ['--force' => true]);
        Bus::fake();
        Http::preventStrayRequests();
        Http::fake([
            'api.coingecko.com/*' => Http::response([
                'ethereum' => ['usd' => 2000, 'last_updated_at' => now()->timestamp],
                'tether' => ['usd' => 1, 'last_updated_at' => now()->timestamp],
                'bitcoin' => ['usd' => 100000, 'last_updated_at' => now()->timestamp],
                'solana' => ['usd' => 100, 'last_updated_at' => now()->timestamp],
                'ripple' => ['usd' => 2, 'last_updated_at' => now()->timestamp],
            ]),
            '*' => Http::response([]),
        ]);
        foreach (['member' => 'USER', 'admin' => 'ADMIN'] as $id => $role) {
            DB::table('User')->insert(['id' => $id, 'name' => ucfirst($id), 'email' => $id.'@example.test', 'role' => $role,
                'passwordHash' => password_hash('Isolated-test-password-01', PASSWORD_BCRYPT), 'referralCode' => 'REF-'.$id, 'updatedAt' => Qfs::now()]);
            DB::table('Account')->insert(['id' => $id, 'userId' => $id, 'updatedAt' => Qfs::now()]);
        }
        $this->member = SessionAuth::issue('member');
        $this->admin = SessionAuth::issue('admin');
        DB::table('InvestmentPlan')->insert(['id' => 'plan', 'name' => 'QFS Starter', 'minAmountCents' => 10000, 'maxAmountCents' => 4999900,
            'monthlyRoiBps' => 1000, 'termMonths' => 3, 'payoutInterval' => 'HOURLY', 'terms' => 'Original investment terms', 'updatedAt' => Qfs::now()]);
        DB::table('ReceivingWallet')->insert(['id' => 'treasury', 'assetKey' => 'ETH', 'label' => 'Ethereum', 'address' => '0x'.str_repeat('1', 40)]);
    }

    private function member(): static
    {
        return $this->withUnencryptedCookie('qfs_session', $this->member);
    }

    private function invest(string $asset, int $amount, string $reference): array
    {
        $quote = $this->member()->postJson('/api/wallet/quotes', ['purpose' => 'INVESTMENT', 'assetKey' => $asset, 'amount' => $amount])->assertOk()->json('data');

        return $this->member()->postJson('/api/investments', ['planId' => 'plan', 'amount' => $amount, 'quoteId' => $quote['id'], 'reference' => $reference])->assertOk()->json('data');
    }

    public function test_approved_deposit_and_swapped_crypto_can_be_invested_and_withdrawn_without_a_usd_swap(): void
    {
        $deposit = $this->member()->postJson('/api/wallet/deposits', ['walletId' => 'treasury', 'quantity' => '2', 'reference' => 'DEP-restored'])->assertOk()->json('data.request.id');
        $this->assertSame(0, DB::table('CryptoBalance')->count());
        $this->withUnencryptedCookie('qfs_session', $this->admin)->patchJson('/api/admin/requests/'.$deposit.'?type=DEPOSIT', ['action' => 'APPROVE'])->assertOk();
        $this->assertSame(0, DB::table('Account')->where('userId', 'member')->value('availableCents'));
        $investment = $this->invest('ETH', 1000, 'INV-direct-crypto');
        $this->assertSame('ETH', json_decode($investment['investment']['funding'], true)['assetKey']);
        $this->assertSame('1500000000000000000', DB::table('CryptoBalance')->where('assetKey', 'ETH')->value('totalAtomic'));
        $quote = $this->member()->postJson('/api/wallet/swaps/quote', ['fromAsset' => 'ETH', 'toAsset' => 'USDT_BEP20', 'quantity' => '0.5'])->assertOk()->json('data');
        $body = ['quoteId' => $quote['id'], 'reference' => 'SWAP-restored'];
        $this->member()->postJson('/api/wallet/swaps', $body)->assertOk()->assertJsonPath('data.status', 'COMPLETED');
        $this->member()->postJson('/api/wallet/swaps', $body)->assertOk();
        $this->assertSame(1, DB::table('CryptoSwap')->count());
        $this->invest('USDT_BEP20', 500, 'INV-after-swap');
        $this->assertSame(0, DB::table('Account')->where('userId', 'member')->value('availableCents'));
        $quote = $this->member()->postJson('/api/wallet/quotes', ['purpose' => 'CRYPTO_WITHDRAWAL', 'assetKey' => 'USDT_BEP20', 'quantity' => '200'])->assertOk()->json('data');
        $request = $this->member()->postJson('/api/wallet/withdrawals', ['quoteId' => $quote['id'], 'reference' => 'WD-after-swap', 'address' => '0x'.str_repeat('2', 40)])->assertOk()->json('data.request.id');
        $this->withUnencryptedCookie('qfs_session', $this->admin)->patchJson('/api/admin/requests/'.$request.'?type=WITHDRAWAL', ['action' => 'APPROVE'])->assertOk();
        $this->assertSame('300000000000000000000', DB::table('CryptoBalance')->where('assetKey', 'USDT_BEP20')->value('totalAtomic'));
        $this->assertSame('0', DB::table('CryptoBalance')->where('assetKey', 'USDT_BEP20')->value('reservedAtomic'));
        $this->assertSame(150000, DB::table('Investment')->where('userId', 'member')->sum('amountCents'));
        $this->assertNull(DB::table('WithdrawalRequest')->where('id', $request)->value('txHash'));
    }

    public function test_investment_confirmation_replays_credit_only_once_and_keeps_recorded_terms(): void
    {
        DB::transaction(fn () => CryptoFunds::move(CryptoFunds::balance('member', 'ETH'), '1000000000000000000', '0', 'DEPOSIT', '1000000000000000000', 'FIXTURE-FUNDING'));
        $quote = $this->member()->postJson('/api/wallet/quotes', ['purpose' => 'INVESTMENT', 'assetKey' => 'ETH', 'amount' => 1000])->assertOk()->json('data');
        $body = ['planId' => 'plan', 'amount' => 1000, 'quoteId' => $quote['id'], 'reference' => 'INV-retry'];
        $this->member()->postJson('/api/investments', $body)->assertOk()->assertJsonPath('data.created', true);
        $this->member()->postJson('/api/investments', $body)->assertOk()->assertJsonPath('data.created', false);
        $this->assertSame(1, DB::table('Investment')->count());
        $this->assertSame('500000000000000000', DB::table('CryptoBalance')->value('totalAtomic'));
        DB::table('InvestmentPlan')->where('id', 'plan')->update(['terms' => 'Changed plan terms', 'monthlyRoiBps' => 2000]);
        $page = $this->member()->get('/user/user/dashboard/investments')->assertOk()->assertSee('Original investment terms')->assertSee('Funded with')->assertSee('Next profit payout')->assertSee('Supporting documents')->assertSee('Completed investments');
        $dom = new \DOMDocument;
        @$dom->loadHTML('<?xml encoding="UTF-8">'.$page->getContent());
        $positions = (new \DOMXPath($dom))->query('//details[@data-investment-id]');
        $this->assertSame(1, $positions->length);
        $this->assertStringContainsString('Original investment terms', $positions->item(0)->textContent);
        $this->assertStringNotContainsString('Changed plan terms', $positions->item(0)->textContent);
    }

    public function test_document_upload_plan_assignment_and_investment_document_access_are_preserved(): void
    {
        Storage::fake('local');
        $document = $this->withUnencryptedCookie('qfs_session', $this->admin)->post('/api/admin/documents/upload', ['code' => 'terms', 'title' => 'Investment agreement', 'flagPath' => '/favicon.ico', 'sort' => 0, 'isActive' => true,
            'file' => UploadedFile::fake()->createWithContent('agreement.pdf', "%PDF-1.7\nFixture agreement\n%%EOF")])->assertOk()->json('data');
        $this->withUnencryptedCookie('qfs_session', $this->admin)->patchJson('/api/admin/plans/plan', ['documentIds' => [$document['id']]])->assertOk();
        DB::table('Account')->where('userId', 'member')->update(['balanceCents' => 10000, 'availableCents' => 10000]);
        $this->member()->postJson('/api/investments', ['planId' => 'plan', 'amount' => 100, 'reference' => 'INV-with-document'])->assertOk();
        $this->member()->get('/user/user/dashboard/investments')->assertOk()->assertSee($document['fileUrl'])->assertSee('Investment agreement');
        $this->member()->get($document['fileUrl'])->assertOk()->assertHeader('Content-Type', 'application/pdf');
    }

    public function test_sample_review_distribution_is_disclosed_and_real_ratings_remain_data_driven(): void
    {
        config()->set('qfs.illustrative_reviews', true);
        $summary = Reviews::ratingSummary();
        $this->assertSame(50, $summary['total']);
        $this->assertSame([92, 6, 2, 0, 0], array_column($summary['stars'], 'percent'));
        $this->assertSame('', Reviews::forOverview()[0]['meta']);
        $this->assertSame(0, DB::table('Review')->count());
        $this->member()->get('/user/user/dashboard')->assertOk()->assertSee('Illustrative reviews')->assertSee('Write a review');
        config()->set('qfs.illustrative_reviews', false);
        foreach ([5, 4] as $i => $rating) {
            DB::table('Review')->insert(['id' => 'review-'.$i, 'userName' => 'Example reviewer', 'rating' => $rating, 'text' => 'An approved example review.', 'status' => 'APPROVED']);
        }
        $this->assertSame([50, 50, 0, 0, 0], array_column(Reviews::ratingSummary()['stars'], 'percent'));
        $this->member()->postJson('/api/reviews', ['rating' => 3, 'text' => 'A new review awaiting admin approval.'])->assertOk()->assertJsonPath('data.status', 'PENDING');
        $this->assertSame(2, Reviews::ratingSummary()['total']);
    }

    public function test_crypto_quantity_investment_locks_the_usd_value_and_debits_exact_units(): void
    {
        DB::transaction(fn () => CryptoFunds::move(CryptoFunds::balance('member', 'XRP'), '500000000', '0', 'DEPOSIT', '500000000', 'FIXTURE-XRP'));
        $quote = $this->member()->postJson('/api/wallet/quotes', ['purpose' => 'INVESTMENT', 'assetKey' => 'XRP', 'quantity' => '100.123456'])
            ->assertOk()->assertJsonPath('data.amountCents', 20024)->assertJsonPath('data.quantity', '100.123456')->json('data');
        $this->member()->postJson('/api/investments', ['planId' => 'plan', 'amount' => 200.24, 'quoteId' => $quote['id'], 'reference' => 'INV-quantity'])->assertOk();
        $this->assertSame('399876544', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('totalAtomic'));
        $this->assertSame(20024, DB::table('Investment')->value('amountCents'));
        $this->member()->postJson('/api/wallet/quotes', ['purpose' => 'INVESTMENT', 'assetKey' => 'XRP', 'quantity' => '500.000001'])->assertStatus(400)->assertJsonPath('error.code', 'INSUFFICIENT_FUNDS');
        $this->member()->postJson('/api/wallet/quotes', ['purpose' => 'INVESTMENT', 'assetKey' => 'XRP', 'quantity' => '1', 'amount' => 1])->assertStatus(400)->assertJsonPath('error.code', 'AMOUNT');
    }

    public function test_deletion_requires_confirmation_and_reauthentication_and_preserves_financial_records(): void
    {
        DB::table('Account')->where('userId', 'member')->update(['balanceCents' => 10000, 'availableCents' => 10000]);
        $body = ['action' => 'DELETE', 'confirmation' => 'member@example.test', 'reason' => 'Remove fixture account', 'currentPassword' => 'Isolated-test-password-01'];
        $this->member()->patchJson('/api/admin/users/admin', $body)->assertForbidden();
        $this->withUnencryptedCookie('qfs_session', $this->admin)->patchJson('/api/admin/users/admin', $body)->assertStatus(400);
        $this->patchJson('/api/admin/users/member', [...$body, 'currentPassword' => 'Wrong-password-01'])->assertStatus(400)->assertJsonPath('error.code', 'INVALID_PASSWORD');
        $this->patchJson('/api/admin/users/member', [...$body, 'confirmation' => 'wrong@example.test'])->assertStatus(400)->assertJsonPath('error.code', 'CONFIRMATION');
        $this->assertSame('ACTIVE', DB::table('User')->where('id', 'member')->value('status'));
        $this->patchJson('/api/admin/users/member', $body)->assertOk()->assertJsonPath('data.financialRecordsRetained', true);
        $this->assertSame('DELETED', DB::table('User')->where('id', 'member')->value('status'));
        $this->assertSame(10000, DB::table('Account')->where('userId', 'member')->value('availableCents'));
        $this->assertSame(0, DB::table('Session')->where('userId', 'member')->count());
        $this->getJson('/api/admin/users')->assertOk()->assertJsonPath('data.total', 1);
        $this->postJson('/api/admin/adjustments', ['scope' => 'ALL', 'direction' => 'CREDIT', 'amount' => 1, 'note' => 'Deleted accounts excluded'])->assertOk()->assertJsonPath('data.total', 0);
        $this->postJson('/api/admin/adjustments', ['scope' => 'USER', 'userId' => 'member', 'direction' => 'CREDIT', 'amount' => 1, 'note' => 'Deleted account excluded'])->assertStatus(409);
        $this->member()->getJson('/api/auth/me')->assertUnauthorized();
        $this->assertSame(1, DB::table('AuditLog')->where('action', 'USER.DELETE')->count());
    }

    public function test_public_address_review_approval_does_not_connect_a_wallet_or_change_balances(): void
    {
        DB::table('Account')->where('userId', 'member')->update(['balanceCents' => 10000, 'availableCents' => 10000]);
        $id = $this->member()->postJson('/api/wallet/issues', ['subject' => 'MANUAL_REVIEW', 'walletProvider' => 'MetaMask',
            'assetKey' => 'ETH', 'publicAddress' => '0x'.str_repeat('1', 40)])->assertOk()->json('data.id');
        $this->withUnencryptedCookie('qfs_session', $this->admin)->patchJson('/api/admin/wallet-issues/'.$id, ['action' => 'APPROVE'])->assertOk();
        $this->assertSame(0, DB::table('WalletConnection')->count());
        $this->assertSame(10000, DB::table('Account')->where('userId', 'member')->value('availableCents'));
        $this->assertSame('Wallet review approved', DB::table('Notification')->where('userId', 'member')->value('title'));
        $this->member()->get('/user/user/connect')->assertOk()->assertSee('Request manual wallet review')->assertDontSee('<textarea id="seed', false);
    }

    public function test_hungarian_auth_pages_and_full_language_names_are_available(): void
    {
        $this->withUnencryptedCookie('qfs_locale', 'hu')->get('/admin/login')->assertOk()
            ->assertSee('Adminisztrátori bejelentkezés')->assertSee('Magyar')->assertSee('Deutsch')->assertSee('Kiswahili');
    }

    public function test_visual_comparison_fixture_has_funded_crypto_and_a_reviewable_plan(): void
    {
        DB::table('User')->where('id', 'member')->update(['name' => 'Interface Investor']);
        DB::table('User')->where('id', 'admin')->update(['name' => 'Interface Admin']);
        DB::table('Account')->where('userId', 'member')->update(['balanceCents' => 3500000, 'availableCents' => 3500000]);
        DB::transaction(function (): void {
            CryptoFunds::move(CryptoFunds::balance('member', 'XRP'), '500000000', '0', 'DEPOSIT', '500000000', 'FIXTURE-XRP');
            CryptoFunds::move(CryptoFunds::balance('member', 'ETH'), '1000000000000000000', '0', 'DEPOSIT', '1000000000000000000', 'FIXTURE-ETH');
        });
        $this->member()->getJson('/api/wallet/funds')->assertOk()->assertJsonPath('data.usd.availableCents', 3500000);
        $this->member()->postJson('/api/wallet/quotes', ['purpose' => 'INVESTMENT', 'assetKey' => 'XRP', 'quantity' => '500'])->assertOk()->assertJsonPath('data.amountCents', 100000);
        if ($path = getenv('QFS_UI_FIXTURE')) {
            if (! str_ends_with($path, '_test.sqlite')) {
                throw new \RuntimeException('A disposable UI test database path is required.');
            }
            DB::statement('VACUUM INTO ?', [$path]);
        }
    }

    public function test_login_redirects_respect_https_only_from_the_local_reverse_proxy(): void
    {
        $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1'])
            ->get('http://proxy.example.test:8443/admin', ['X-Forwarded-Proto' => 'https'])
            ->assertRedirect('https://proxy.example.test:8443/admin/login');
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.10'])
            ->get('http://proxy.example.test:8443/admin', ['X-Forwarded-Proto' => 'https'])
            ->assertRedirect('http://proxy.example.test:8443/admin/login');
        $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1'])
            ->get('http://localhost:8082/user/user/dashboard', ['X-Forwarded-Proto' => 'http'])
            ->assertRedirect('http://localhost:8082/user/user/login');
    }

    public function test_dashboard_and_admin_pages_keep_the_new_architecture_and_restored_controls(): void
    {
        foreach (['', '/investments', '/transactions', '/withdrawals', '/loans', '/verification', '/settings', '/statements'] as $view) {
            $response = $this->member()->get('/user/user/dashboard'.$view)->assertOk();
            $this->assertAlpineTemplateRoots($response->getContent());
        }
        foreach (AdminController::PAGES as $page) {
            $response = $this->withUnencryptedCookie('qfs_session', $this->admin)->get('/admin/'.$page)->assertOk();
            $this->assertAlpineTemplateRoots($response->getContent());
        }
        $this->withUnencryptedCookie('qfs_session', $this->admin)->get('/admin/plans')->assertSee('Supporting documents')->assertSee('Apply reviewed translation');
        $this->withUnencryptedCookie('qfs_session', $this->admin)->get('/admin/documents')->assertSee('Upload PDF');
    }

    private function assertAlpineTemplateRoots(string $html): void
    {
        $document = new \DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $document->loadHTML('<?xml encoding="UTF-8">'.$html);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        foreach ($document->getElementsByTagName('template') as $template) {
            if (! $template->hasAttribute('x-if') && ! $template->hasAttribute('x-for')) {
                continue;
            }
            $elements = 0;
            foreach ($template->childNodes as $child) {
                $elements += $child instanceof \DOMElement ? 1 : 0;
            }
            $this->assertSame(1, $elements, 'Alpine template must have one root: '.$template->getAttribute('x-if').$template->getAttribute('x-for'));
        }
    }
}
