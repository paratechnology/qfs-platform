<?php

namespace Tests\Feature;

use App\Support\CryptoAssets;
use App\Support\SessionAuth;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;

class CryptoFundingTest extends InvestmentEarningsTest
{
    private string $memberToken;

    private string $reviewToken;

    protected function setUp(): void
    {
        parent::setUp();
        Schema::table('Transaction', fn (Blueprint $t) => $t->string('currency')->default('USD'));
        Schema::table('LedgerEntry', fn (Blueprint $t) => $t->string('txId')->nullable()->change());
        Schema::create('Setting', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('key');
            $t->string('value');
        });
        foreach (['DepositRequest', 'WithdrawalRequest'] as $name) {
            Schema::create($name, function (Blueprint $t) {
                $t->string('id')->primary();
                $t->string('userId');
                $t->integer('amountCents');
                $t->string('method');
                $t->string('reference')->unique();
                $t->string('status')->default('PENDING');
                $t->string('walletAddress')->nullable();
                $t->string('details')->nullable();
                $t->string('reviewedById')->nullable();
                $t->timestamp('reviewedAt')->nullable();
                $t->string('adminNote')->nullable();
                $t->string('transactionId')->nullable();
                $t->timestamp('createdAt')->useCurrent();
            });
        }
        (require database_path('migrations/2026_10_15_220916_add_crypto_funding.php'))->up();
        (require database_path('migrations/2026_10_15_233318_add_crypto_swaps.php'))->up();
        (require database_path('migrations/2026_10_16_000232_support_batched_swap_settlements.php'))->up();
        $this->memberToken = SessionAuth::issue('user');
        $this->reviewToken = SessionAuth::issue('admin');
        DB::table('ReceivingWallet')->insert(['id' => 'receiving', 'assetKey' => 'ETH', 'label' => 'Ethereum treasury', 'address' => '0x'.str_repeat('1', 40)]);
        Http::preventStrayRequests();
        Http::fake(['api.coingecko.com/*' => fn () => Http::response([
            'ethereum' => ['usd' => config('test.cryptoPrice', 2000), 'last_updated_at' => config('test.cryptoTimestamp', now()->timestamp)],
            'bitcoin' => ['usd' => 100000, 'last_updated_at' => now()->timestamp],
            'tether' => ['usd' => 0.999, 'last_updated_at' => now()->timestamp],
        ])]);
    }

    private function deposit(string $quantity = '1', string $reference = 'DEP-crypto-test'): string
    {
        $reply = $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/deposits', ['walletId' => 'receiving', 'quantity' => $quantity, 'reference' => $reference])
            ->assertOk();

        return $reply->json('data.request.id');
    }

    private function credited(): void
    {
        DB::table('InvestmentPlan')->insert([
            'id' => 'starter', 'name' => 'QFS Starter', 'minAmountCents' => 10000, 'maxAmountCents' => 4999900,
            'monthlyRoiBps' => 1000, 'termMonths' => 3, 'payoutInterval' => 'HOURLY',
        ]);
        $id = $this->deposit();
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->patchJson('/api/wallet/deposits/'.$id, ['txHash' => '0x'.str_repeat('a', 64)])->assertOk();
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/requests/'.$id, ['action' => 'APPROVE'])->assertOk();
    }

    private function quote(string $purpose, array $values): array
    {
        return $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/quotes', ['purpose' => $purpose, 'assetKey' => 'ETH', ...$values])
            ->assertOk()->json('data');
    }

    public function test_hashless_deposits_can_be_saved_but_only_admin_approval_credits_once(): void
    {
        $id = $this->deposit('0.000000000000000001');
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->patchJson('/api/admin/requests/'.$id, ['action' => 'APPROVE'])->assertForbidden();
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->patchJson('/api/wallet/deposits/'.$id, ['txHash' => ''])->assertOk();
        $this->assertSame(0, DB::table('CryptoBalance')->count());
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/requests/'.$id, ['action' => 'APPROVE'])->assertOk();
        $this->assertSame('1', DB::table('CryptoBalance')->value('totalAtomic'));
        $this->assertSame(10000, DB::table('Account')->value('balanceCents'));
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/requests/'.$id, ['action' => 'APPROVE'])->assertOk()->assertJsonPath('data.alreadyReviewed', true);
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/requests/'.$id, ['action' => 'REJECT'])->assertStatus(409);
        $this->assertSame(1, DB::table('CryptoLedger')->count());
        $this->assertNull(DB::table('DepositRequest')->where('id', $id)->value('txHash'));
        $this->assertNull(DB::table('DepositRequest')->where('id', $id)->value('chainTxKey'));
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)->getJson('/api/transactions')
            ->assertOk()->assertJsonPath('data.items.0.amount', '0.000000000000000001 ETH');
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)->getJson('/api/admin/requests')
            ->assertOk()->assertJsonPath('data.items.0.amount', '0.000000000000000001 ETH');
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)->getJson('/api/admin/transactions')
            ->assertOk()->assertJsonPath('data.items.0.amount', '0.000000000000000001 ETH');
    }

    public function test_transfer_reuse_and_deposit_reference_changes_are_rejected(): void
    {
        $id = $this->deposit();
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/deposits', ['walletId' => 'receiving', 'quantity' => '2', 'reference' => 'DEP-crypto-test'])->assertStatus(409);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->patchJson('/api/wallet/deposits/'.$id, ['txHash' => '0x'.str_repeat('c', 64)])->assertOk();
        $other = $this->deposit('1', 'DEP-other');
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->patchJson('/api/wallet/deposits/'.$other, ['txHash' => '0x'.str_repeat('c', 64)])->assertStatus(409);
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/wallet/deposits/'.$other, ['txHash' => '0x'.str_repeat('d', 64)])->assertNotFound();
    }

    public function test_crypto_investment_locks_usd_and_a_retry_does_not_spend_twice(): void
    {
        $this->credited();
        $quote = $this->quote('INVESTMENT', ['amount' => 1000]);
        $payload = ['planId' => 'starter', 'amount' => 1000, 'quoteId' => $quote['id'], 'reference' => 'INV-crypto'];
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/investments', $payload)->assertOk()->assertJsonPath('data.created', true);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/investments', $payload)->assertOk()->assertJsonPath('data.created', false);
        $this->assertSame('500000000000000000', DB::table('CryptoBalance')->value('totalAtomic'));
        $this->assertSame(110000, DB::table('Account')->value('balanceCents'));
        $this->assertSame(10000, DB::table('Account')->value('availableCents'));
        $investment = DB::table('Investment')->first();
        $this->assertSame(100000, $investment->amountCents);
        $funding = json_decode($investment->funding, true);
        $this->assertSame('2000', $funding['rateUsd']);
        $this->assertSame('0.5', $funding['quantity']);
        Cache::forget('qfs.funding.prices.v1');
        config()->set('test.cryptoPrice', 1000);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->getJson('/api/wallet/funds')->assertOk()->assertJsonPath('data.holdings.1.usd', '$500.00');
        $this->assertSame(100000, DB::table('Investment')->value('amountCents'));
    }

    public function test_expired_foreign_and_mismatched_quotes_cannot_fund_investments(): void
    {
        $this->credited();
        $quote = $this->quote('INVESTMENT', ['amount' => 1000]);
        $payload = ['planId' => 'starter', 'amount' => 1000, 'quoteId' => $quote['id'], 'reference' => 'INV-protected'];
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)->postJson('/api/investments', $payload)->assertStatus(404);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)->postJson('/api/investments', [...$payload, 'amount' => 1001])->assertStatus(400);
        DB::table('CryptoQuote')->where('id', $quote['id'])->update(['expiresAt' => now()->subSecond()]);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)->postJson('/api/investments', $payload)->assertStatus(409);
        $this->assertSame('1000000000000000000', DB::table('CryptoBalance')->value('totalAtomic'));
        $this->assertSame(0, DB::table('Investment')->count());
    }

    public function test_reservations_prevent_overdraw_and_rejection_restores_exact_crypto(): void
    {
        $this->credited();
        $quote = $this->quote('CRYPTO_WITHDRAWAL', ['quantity' => '0.75']);
        $payload = ['quoteId' => $quote['id'], 'address' => '0x'.str_repeat('2', 40), 'reference' => 'WD-reserve'];
        $response = $this->withUnencryptedCookie('qfs_session', $this->memberToken)->postJson('/api/wallet/withdrawals', $payload)->assertOk();
        $id = $response->json('data.request.id');
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)->postJson('/api/wallet/withdrawals', $payload)->assertOk();
        $this->assertSame('750000000000000000', DB::table('CryptoBalance')->value('reservedAtomic'));
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/quotes', ['purpose' => 'INVESTMENT', 'assetKey' => 'ETH', 'amount' => 1000])->assertStatus(400);
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/requests/'.$id.'?type=WITHDRAWAL', ['action' => 'REJECT'])->assertOk();
        $this->assertSame('0', DB::table('CryptoBalance')->value('reservedAtomic'));
        $this->assertSame('1000000000000000000', DB::table('CryptoBalance')->value('totalAtomic'));
    }

    public function test_usd_crypto_payout_can_omit_the_hash_and_debits_once(): void
    {
        $quote = $this->quote('USD_WITHDRAWAL', ['amount' => 50]);
        $id = $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/withdrawals', ['quoteId' => $quote['id'], 'address' => '0x'.str_repeat('2', 40), 'reference' => 'WD-usd'])
            ->assertOk()->json('data.request.id');
        $this->assertSame(5000, DB::table('Account')->value('availableCents'));
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/requests/'.$id.'?type=WITHDRAWAL', ['action' => 'APPROVE'])->assertOk();
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/requests/'.$id.'?type=WITHDRAWAL', ['action' => 'APPROVE'])->assertOk()->assertJsonPath('data.alreadyReviewed', true);
        $this->assertSame(5000, DB::table('Account')->value('balanceCents'));
        $this->assertSame(5000, DB::table('Account')->value('availableCents'));
        $this->assertSame(1, DB::table('Transaction')->where('type', 'WITHDRAWAL')->count());
        $this->assertNull(DB::table('WithdrawalRequest')->where('id', $id)->value('txHash'));
    }

    public function test_admin_can_correct_or_clear_a_deposit_hash_without_releasing_prior_claims(): void
    {
        $old = '0x'.str_repeat('1', 64);
        $correct = '0x'.str_repeat('2', 64);
        $id = $this->deposit();
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->patchJson('/api/wallet/deposits/'.$id, ['txHash' => $old])->assertOk();
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/requests/'.$id, ['action' => 'APPROVE', 'txHash' => $correct])->assertOk();
        $this->assertSame($correct, DB::table('DepositRequest')->where('id', $id)->value('txHash'));
        $this->assertSame(2, DB::table('CryptoTransferClaim')->count());

        $other = $this->deposit('1', 'DEP-clear');
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->patchJson('/api/wallet/deposits/'.$other, ['txHash' => '0x'.str_repeat('3', 64)])->assertOk();
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/requests/'.$other, ['action' => 'APPROVE', 'txHash' => ''])->assertOk();
        $this->assertNull(DB::table('DepositRequest')->where('id', $other)->value('txHash'));
        $this->assertNull(DB::table('DepositRequest')->where('id', $other)->value('chainTxKey'));
        $third = $this->deposit('1', 'DEP-reused');
        foreach ([$old, $correct, '0x'.str_repeat('3', 64)] as $hash) {
            $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
                ->patchJson('/api/admin/requests/'.$third, ['action' => 'APPROVE', 'txHash' => $hash])->assertStatus(409);
        }
        $this->assertSame('PENDING', DB::table('DepositRequest')->where('id', $third)->value('status'));
        $this->assertSame(2, DB::table('CryptoLedger')->count());
    }

    public function test_malformed_optional_hashes_fail_without_changing_status_or_balance(): void
    {
        $id = $this->deposit();
        foreach (['mistyped', '0'] as $hash) {
            $this->withUnencryptedCookie('qfs_session', $this->memberToken)
                ->patchJson('/api/wallet/deposits/'.$id, ['txHash' => $hash])->assertStatus(400);
            $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
                ->patchJson('/api/admin/requests/'.$id, ['action' => 'APPROVE', 'txHash' => $hash])->assertStatus(400);
        }
        $this->assertSame('PENDING', DB::table('DepositRequest')->where('id', $id)->value('status'));
        $this->assertSame(0, DB::table('CryptoLedger')->count());
    }

    public function test_unchanged_hash_is_preserved_and_approval_retry_does_not_notify_twice(): void
    {
        $id = $this->deposit();
        $hash = '0x'.str_repeat('f', 64);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->patchJson('/api/wallet/deposits/'.$id, ['txHash' => $hash])->assertOk();
        for ($i = 0; $i < 2; $i++) {
            $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
                ->patchJson('/api/admin/requests/'.$id, ['action' => 'APPROVE'])->assertOk()->assertJsonPath('data.alreadyReviewed', $i === 1);
        }
        $this->assertSame($hash, DB::table('DepositRequest')->where('id', $id)->value('txHash'));
        $this->assertSame(1, DB::table('CryptoLedger')->count());
        $this->assertSame(1, DB::table('Notification')->count());
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/requests/'.$id, ['action' => 'APPROVE', 'txHash' => ''])->assertStatus(409);
    }

    public function test_mail_queue_failure_does_not_report_a_committed_approval_as_failed(): void
    {
        config()->set('qfs.account_emails', true);
        Bus::shouldReceive('dispatch')->once()->andThrow(new \RuntimeException('Queue unavailable'));
        $id = $this->deposit();
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/requests/'.$id, ['action' => 'APPROVE'])->assertOk();
        $this->assertSame('APPROVED', DB::table('DepositRequest')->where('id', $id)->value('status'));
        $this->assertSame('1000000000000000000', DB::table('CryptoBalance')->value('totalAtomic'));
    }

    public function test_crypto_payouts_accept_blank_hashes_and_validate_supplied_hashes(): void
    {
        $this->credited();
        $quote = $this->quote('CRYPTO_WITHDRAWAL', ['quantity' => '0.25']);
        $id = $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/withdrawals', ['quoteId' => $quote['id'], 'address' => '0x'.str_repeat('2', 40), 'reference' => 'WD-optional'])
            ->assertOk()->json('data.request.id');
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/requests/'.$id.'?type=WITHDRAWAL', ['action' => 'APPROVE', 'txHash' => 'mistyped'])->assertStatus(400);
        $this->assertSame('250000000000000000', DB::table('CryptoBalance')->value('reservedAtomic'));
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/requests/'.$id.'?type=WITHDRAWAL', ['action' => 'APPROVE', 'txHash' => ''])->assertOk();
        $this->assertSame('0', DB::table('CryptoBalance')->value('reservedAtomic'));
        $this->assertSame('750000000000000000', DB::table('CryptoBalance')->value('totalAtomic'));
    }

    public function test_supplied_payout_hashes_are_recorded_and_cannot_be_reused(): void
    {
        $this->credited();
        $hash = '0x'.str_repeat('e', 64);
        for ($i = 0; $i < 2; $i++) {
            $quote = $this->quote('CRYPTO_WITHDRAWAL', ['quantity' => '0.1']);
            $id = $this->withUnencryptedCookie('qfs_session', $this->memberToken)
                ->postJson('/api/wallet/withdrawals', ['quoteId' => $quote['id'], 'address' => '0x'.str_repeat('2', 40), 'reference' => 'WD-hash-'.$i])
                ->assertOk()->json('data.request.id');
            $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
                ->patchJson('/api/admin/requests/'.$id.'?type=WITHDRAWAL', ['action' => 'APPROVE', 'txHash' => $hash])->assertStatus($i === 0 ? 200 : 409);
        }
        $this->assertSame(1, DB::table('WithdrawalRequest')->where('status', 'APPROVED')->count());
        $this->assertSame($hash, DB::table('WithdrawalRequest')->where('status', 'APPROVED')->value('txHash'));
        $this->assertSame('900000000000000000', DB::table('CryptoBalance')->value('totalAtomic'));
        $this->assertSame('100000000000000000', DB::table('CryptoBalance')->value('reservedAtomic'));
    }

    public function test_stale_prices_stop_conversion_without_hiding_owned_crypto(): void
    {
        $this->credited();
        config()->set('test.cryptoTimestamp', now()->subMinutes(5)->timestamp);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/quotes', ['purpose' => 'INVESTMENT', 'assetKey' => 'ETH', 'amount' => 1000])->assertStatus(503);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->getJson('/api/wallet/funds')->assertOk()->assertJsonPath('data.valuationComplete', false)
            ->assertJsonPath('data.totalUsd', null)->assertJsonPath('data.availableUsd', null)
            ->assertJsonPath('data.usd.available', '$100.00')->assertJsonPath('data.holdings.1.available', '1');
    }

    public function test_available_balance_combines_cash_and_each_crypto_network_without_counting_locked_funds(): void
    {
        DB::table('Account')->where('userId', 'user')->update(['balanceCents' => 4500000, 'availableCents' => 3500000]);
        foreach (['ETH' => '1', 'USDT_TRC20' => '13000', 'USDT_BEP20' => '20000'] as $key => $quantity) {
            DB::table('CryptoBalance')->insert(['id' => 'balance-'.$key, 'userId' => 'user', 'assetKey' => $key,
                'totalAtomic' => CryptoAssets::units($key, $quantity), 'reservedAtomic' => '0']);
        }
        $prices = [];
        foreach (CryptoAssets::ALL as $key => $asset) {
            $prices[$key] = ['rate' => $key === 'ETH' ? '2000' : '1', 'timestamp' => now()->timestamp];
        }
        Cache::put('qfs.funding.prices.v1', $prices, 30);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)->getJson('/api/wallet/funds')
            ->assertOk()->assertJsonPath('data.usd.available', '$35,000.00')
            ->assertJsonPath('data.availableUsd', '$70,000.00')->assertJsonPath('data.totalUsd', '$80,000.00')
            ->assertJsonPath('data.valuationComplete', true);

        foreach (['ETH' => '0.25', 'USDT_TRC20' => '1000', 'USDT_BEP20' => '2000'] as $key => $reserved) {
            DB::table('CryptoBalance')->where('userId', 'user')->where('assetKey', $key)
                ->update(['reservedAtomic' => CryptoAssets::units($key, $reserved)]);
        }
        $response = $this->withUnencryptedCookie('qfs_session', $this->memberToken)->getJson('/api/wallet/funds')
            ->assertOk()->assertJsonPath('data.availableUsd', '$66,500.00')->assertJsonPath('data.totalUsd', '$80,000.00');
        $holdings = collect($response->json('data.holdings'))->keyBy('assetKey');
        $this->assertSame('0.75', $holdings['ETH']['available']);
        $this->assertSame('$1,500.00', $holdings['ETH']['availableUsd']);
        $this->assertSame('12000', $holdings['USDT_TRC20']['available']);
        $this->assertSame('$12,000.00', $holdings['USDT_TRC20']['availableUsd']);
        $this->assertSame('18000', $holdings['USDT_BEP20']['available']);
        $this->assertSame('$18,000.00', $holdings['USDT_BEP20']['availableUsd']);
        $this->assertSame(3500000, DB::table('Account')->where('userId', 'user')->value('availableCents'));
        $this->assertSame(0, DB::table('CryptoLedger')->count());
    }

    public function test_receiving_wallets_require_admin_and_existing_instructions_survive_retirement(): void
    {
        $id = $this->deposit();
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/admin/receiving-wallets', ['assetKey' => 'ETH', 'label' => 'Unauthorized', 'address' => '0x'.str_repeat('2', 40)])->assertForbidden();
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/receiving-wallets/receiving', ['isActive' => false])->assertOk();
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/deposits', ['walletId' => 'receiving', 'quantity' => '1', 'reference' => 'DEP-retired'])->assertStatus(409);
        $this->assertSame('0x'.str_repeat('1', 40), DB::table('DepositRequest')->where('id', $id)->value('receivingAddress'));
    }

    public function test_wallet_edits_keep_existing_deposit_destinations_and_use_the_new_address_for_new_instructions(): void
    {
        $original = '0x'.str_repeat('1', 40);
        $updated = '0x'.str_repeat('2', 40);
        $depositId = $this->deposit('1', 'DEP-before-edit');
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->patchJson('/api/admin/receiving-wallets/receiving', ['address' => $updated])->assertForbidden();
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/receiving-wallets/receiving', ['label' => 'Updated treasury', 'address' => $updated, 'destinationTag' => null])
            ->assertOk()->assertJsonPath('data.address', $updated)->assertJsonPath('data.label', 'Updated treasury')
            ->assertJsonPath('data.assetKey', 'ETH')->assertJsonPath('data.isActive', true);
        $this->assertSame($original, DB::table('DepositRequest')->where('id', $depositId)->value('receivingAddress'));
        $this->assertSame($depositId, $this->deposit('1', 'DEP-before-edit'));
        $newId = $this->deposit('1', 'DEP-after-edit');
        $this->assertSame($updated, DB::table('DepositRequest')->where('id', $newId)->value('receivingAddress'));
        $this->assertSame(1, DB::table('ReceivingWallet')->count());
        $this->assertSame(2, DB::table('DepositRequest')->count());
        $this->assertSame(0, DB::table('CryptoLedger')->count());
        $audit = json_decode(DB::table('AuditLog')->where('action', 'RECEIVING_WALLET.UPDATE')->value('meta'), true);
        $this->assertSame($original, $audit['before']['address']);
        $this->assertSame($updated, $audit['after']['address']);
    }

    public function test_wallet_edits_validate_the_network_reject_duplicates_and_preserve_enable_disable_state(): void
    {
        $original = '0x'.str_repeat('1', 40);
        $other = '0x'.str_repeat('3', 40);
        $updated = '0x'.str_repeat('4', 40);
        DB::table('ReceivingWallet')->insert(['id' => 'inactive', 'assetKey' => 'ETH', 'label' => 'Inactive treasury', 'address' => $other, 'isActive' => false]);
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/receiving-wallets/receiving', ['address' => 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'])
            ->assertStatus(400)->assertJsonPath('error.code', 'ADDRESS');
        $this->patchJson('/api/admin/receiving-wallets/receiving', ['assetKey' => 'USDT_BEP20'])->assertStatus(400);
        $this->patchJson('/api/admin/receiving-wallets/receiving', ['destinationTag' => '123'])->assertStatus(400);
        $this->patchJson('/api/admin/receiving-wallets/receiving', ['address' => $other, 'label' => 'Duplicate edit'])
            ->assertStatus(409)->assertJsonPath('error.code', 'CONFLICT');
        $this->assertSame($original, DB::table('ReceivingWallet')->where('id', 'receiving')->value('address'));
        $this->assertSame('Ethereum treasury', DB::table('ReceivingWallet')->where('id', 'receiving')->value('label'));
        $this->assertSame(0, DB::table('AuditLog')->count());
        $this->patchJson('/api/admin/receiving-wallets/inactive', ['address' => $updated, 'label' => 'Edited inactive wallet'])
            ->assertOk()->assertJsonPath('data.isActive', false)->assertJsonPath('data.address', $updated);
        $this->patchJson('/api/admin/receiving-wallets/inactive', ['isActive' => true])
            ->assertOk()->assertJsonPath('data.isActive', true)->assertJsonPath('data.address', $updated);
        $this->patchJson('/api/admin/receiving-wallets/inactive', ['isActive' => false])
            ->assertOk()->assertJsonPath('data.isActive', false)->assertJsonPath('data.label', 'Edited inactive wallet');
    }

    public function test_xrp_wallet_edits_change_or_clear_tags_without_changing_existing_deposit_instructions(): void
    {
        $wallet = $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->postJson('/api/admin/receiving-wallets', ['assetKey' => 'XRP', 'label' => 'XRP treasury', 'address' => 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 'destinationTag' => '123'])
            ->assertOk()->json('data.id');
        $deposit = $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/deposits', ['walletId' => $wallet, 'quantity' => '1', 'reference' => 'DEP-old-tag'])
            ->assertOk()->json('data.request.id');
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->patchJson('/api/admin/receiving-wallets/'.$wallet, ['destinationTag' => '0'])
            ->assertOk()->assertJsonPath('data.destinationTag', '0');
        $this->patchJson('/api/admin/receiving-wallets/'.$wallet, ['destinationTag' => '4294967296'])->assertStatus(400);
        $this->assertSame('0', DB::table('ReceivingWallet')->where('id', $wallet)->value('destinationTag'));
        $this->patchJson('/api/admin/receiving-wallets/'.$wallet, ['destinationTag' => null])
            ->assertOk()->assertJsonPath('data.destinationTag', null);
        $this->assertSame('123', DB::table('DepositRequest')->where('id', $deposit)->value('destinationTag'));
    }

    public function test_quantities_and_network_addresses_are_validated_without_float_rounding(): void
    {
        $this->assertSame('1', CryptoAssets::units('ETH', '0.000000000000000001'));
        $this->assertSame('0.000000000000000001', CryptoAssets::quantity('ETH', '1'));
        $this->assertSame('1', CryptoAssets::fromUsd('BTC', 1, '1000000', true));
        $this->assertSame('1BoatSLRHtKNngkdXEeobR76b53LETtpyT', CryptoAssets::address('BTC', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'));
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/deposits', ['walletId' => 'receiving', 'quantity' => '1e-3', 'reference' => 'DEP-invalid'])->assertStatus(400);
        $this->withUnencryptedCookie('qfs_session', $this->reviewToken)
            ->postJson('/api/admin/receiving-wallets', ['assetKey' => 'USDT_TRC20', 'label' => 'Wrong network', 'address' => '0x'.str_repeat('2', 40)])->assertStatus(400);
    }

    public static function withdrawalAssets(): array
    {
        return [
            'BTC' => ['BTC', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'],
            'ETH' => ['ETH', '0x'.str_repeat('2', 40)],
            'USDT on Tron' => ['USDT_TRC20', 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'],
            'USDT on BNB' => ['USDT_BEP20', '0x'.str_repeat('2', 40)],
            'XRP' => ['XRP', 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'],
            'SOL' => ['SOL', 'So11111111111111111111111111111111111111112'],
        ];
    }

    #[DataProvider('withdrawalAssets')]
    public function test_each_asset_shows_its_exact_available_balance_and_can_submit_a_full_withdrawal(string $key, string $address): void
    {
        $prices = [];
        foreach (CryptoAssets::ALL as $assetKey => $asset) {
            $prices[$assetKey] = ['rate' => '100', 'timestamp' => now()->timestamp];
        }
        Cache::put('qfs.funding.prices.v1', $prices, 30);
        DB::table('Account')->where('userId', 'user')->update(['balanceCents' => 0, 'availableCents' => 0]);
        DB::table('CryptoBalance')->insert(['id' => 'funded-asset', 'userId' => 'user', 'assetKey' => $key,
            'totalAtomic' => CryptoAssets::units($key, '10'), 'reservedAtomic' => CryptoAssets::units($key, '3')]);
        $index = array_search($key, array_keys(CryptoAssets::ALL), true);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)->getJson('/api/wallet/funds')
            ->assertOk()->assertJsonPath('data.usd.availableCents', 0)
            ->assertJsonPath('data.holdings.'.$index.'.available', '7')
            ->assertJsonPath('data.holdings.'.$index.'.reserved', '3');
        $quote = $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/quotes', ['purpose' => 'CRYPTO_WITHDRAWAL', 'assetKey' => $key, 'quantity' => '7'])
            ->assertOk()->json('data');
        $payload = ['quoteId' => $quote['id'], 'address' => $address, 'reference' => 'WD-entire-'.$key];
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)->postJson('/api/wallet/withdrawals', $payload)
            ->assertOk()->assertJsonPath('data.request.status', 'PENDING')
            ->assertJsonPath('data.request.reference', $payload['reference'])
            ->assertJsonPath('data.request.fundingSource', 'CRYPTO')->assertJsonPath('data.request.quantity', '7');
        DB::table('CryptoQuote')->where('id', $quote['id'])->update(['expiresAt' => now()->subMinute()]);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)->postJson('/api/wallet/withdrawals', $payload)->assertOk();
        $this->assertSame(1, DB::table('WithdrawalRequest')->count());
        $this->assertSame(CryptoAssets::units($key, '10'), DB::table('CryptoBalance')->value('reservedAtomic'));
        $this->assertSame(1, DB::table('CryptoLedger')->where('kind', 'RESERVE')->count());
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)->getJson('/api/wallet/funds')
            ->assertOk()->assertJsonPath('data.holdings.'.$index.'.available', '0');
    }

    public function test_withdrawal_limits_are_explained_before_confirmation_and_checked_again_when_submitting(): void
    {
        DB::table('CryptoBalance')->insert(['id' => 'funded-usdt', 'userId' => 'user', 'assetKey' => 'USDT_TRC20',
            'totalAtomic' => '1000000000', 'reservedAtomic' => '0']);
        DB::table('Setting')->insert(['id' => 'minimum', 'key' => 'min_withdrawal_cents', 'value' => '5000']);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/quotes', ['purpose' => 'CRYPTO_WITHDRAWAL', 'assetKey' => 'USDT_TRC20', 'quantity' => '10'])
            ->assertStatus(400)->assertJsonPath('error.message', 'Minimum withdrawal is $50.00.');
        $this->assertSame(0, DB::table('CryptoQuote')->count());
        DB::table('Setting')->where('key', 'min_withdrawal_cents')->update(['value' => '0']);
        DB::table('Setting')->insert(['id' => 'maximum', 'key' => 'max_withdrawal_daily_cents', 'value' => '10000']);
        DB::table('WithdrawalRequest')->insert(['id' => 'previous', 'userId' => 'user', 'amountCents' => 8000,
            'reference' => 'previous', 'method' => 'Bank Transfer']);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/quotes', ['purpose' => 'CRYPTO_WITHDRAWAL', 'assetKey' => 'USDT_TRC20', 'quantity' => '21'])
            ->assertStatus(400)->assertJsonPath('error.message', 'You can withdraw up to $20.00 within the current 24-hour limit.');
        $quote = $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/quotes', ['purpose' => 'CRYPTO_WITHDRAWAL', 'assetKey' => 'USDT_TRC20', 'quantity' => '20'])
            ->assertOk()->json('data');
        DB::table('WithdrawalRequest')->insert(['id' => 'concurrent', 'userId' => 'user', 'amountCents' => 200,
            'reference' => 'concurrent', 'method' => 'Bank Transfer']);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/withdrawals', ['quoteId' => $quote['id'], 'address' => 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', 'reference' => 'WD-limit'])
            ->assertStatus(400)->assertJsonPath('error.code', 'WITHDRAWAL_LIMIT');
        $this->assertSame('0', DB::table('CryptoBalance')->value('reservedAtomic'));
        $this->assertNull(DB::table('CryptoQuote')->where('id', $quote['id'])->value('usedAt'));
    }

    public function test_expired_withdrawal_quote_does_not_reserve_funds(): void
    {
        $this->credited();
        $quote = $this->quote('CRYPTO_WITHDRAWAL', ['quantity' => '0.5']);
        DB::table('CryptoQuote')->where('id', $quote['id'])->update(['expiresAt' => now()->subSecond()]);
        $this->withUnencryptedCookie('qfs_session', $this->memberToken)
            ->postJson('/api/wallet/withdrawals', ['quoteId' => $quote['id'], 'address' => '0x'.str_repeat('2', 40), 'reference' => 'WD-expired'])
            ->assertStatus(409)->assertJsonPath('error.code', 'QUOTE_EXPIRED');
        $this->assertSame('0', DB::table('CryptoBalance')->value('reservedAtomic'));
        $this->assertSame(0, DB::table('WithdrawalRequest')->count());
    }
}
