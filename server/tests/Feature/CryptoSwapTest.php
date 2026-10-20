<?php

namespace Tests\Feature;

use App\Support\CryptoAssets;
use App\Support\CryptoFunds;
use App\Support\CryptoSwaps;
use App\Support\SessionAuth;
use App\Support\SwapProvider;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class CryptoSwapTest extends TestCase
{
    private string $swapUser;

    private string $swapAdmin;

    private string $keyFile;

    private array $orders = [];

    private int $createdOrders = 0;

    private string $createMode = 'normal';

    private array $disabled = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withCredentials();
        config()->set('qfs.session_secret', str_repeat('x', 64));
        Schema::create('User', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('name');
            $t->string('email');
            $t->string('role')->default('USER');
            $t->string('status')->default('ACTIVE');
        });
        Schema::create('Session', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('tokenHash');
            $t->timestamp('expiresAt');
            $t->timestamp('createdAt');
        });
        Schema::create('Account', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->integer('balanceCents');
            $t->integer('availableCents');
            $t->timestamp('updatedAt')->nullable();
        });
        Schema::create('Transaction', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('type');
            $t->integer('amountCents');
            $t->string('status');
            $t->string('method')->nullable();
            $t->string('reference')->unique();
            $t->text('meta')->nullable();
            $t->string('note')->nullable();
            $t->timestamp('completedAt')->nullable();
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('Notification', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('title');
            $t->text('body')->nullable();
        });
        Schema::create('AuditLog', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('actorId');
            $t->string('actorRole');
            $t->string('action');
            $t->string('targetType');
            $t->string('targetId')->nullable();
            $t->text('meta')->nullable();
        });
        Schema::create('Setting', function (Blueprint $t) {
            $t->string('key');
            $t->string('value');
        });
        Schema::create('Investment', fn (Blueprint $t) => $t->string('id')->primary());
        foreach (['DepositRequest', 'WithdrawalRequest'] as $name) {
            Schema::create($name, function (Blueprint $t) {
                $t->string('id')->primary();
                $t->string('userId');
                $t->integer('amountCents');
                $t->string('method');
                $t->string('reference')->unique();
                $t->string('status')->default('PENDING');
                $t->timestamp('createdAt')->useCurrent();
                $t->string('adminNote')->nullable();
            });
        }
        (require database_path('migrations/2026_10_15_220916_add_crypto_funding.php'))->up();
        (require database_path('migrations/2026_10_15_233318_add_crypto_swaps.php'))->up();
        (require database_path('migrations/2026_10_16_000232_support_batched_swap_settlements.php'))->up();
        DB::table('User')->insert([
            ['id' => 'user', 'name' => 'Investor', 'email' => 'investor@test.local', 'role' => 'USER'],
            ['id' => 'admin', 'name' => 'Admin', 'email' => 'admin@test.local', 'role' => 'ADMIN'],
        ]);
        DB::table('Account')->insert(['id' => 'account', 'userId' => 'user', 'balanceCents' => 10000, 'availableCents' => 10000]);
        Http::preventStrayRequests();
        $this->swapUser = SessionAuth::issue('user');
        $this->swapAdmin = SessionAuth::issue('admin');
        $sslOptions = ['private_key_bits' => 2048];
        $windowsConfig = dirname(PHP_BINARY).'/extras/ssl/openssl.cnf';
        if (is_file($windowsConfig)) {
            $sslOptions['config'] = $windowsConfig;
        }
        $key = openssl_pkey_new($sslOptions);
        openssl_pkey_export($key, $pem, null, $sslOptions);
        $this->keyFile = tempnam(sys_get_temp_dir(), 'qfs-swap-test-');
        file_put_contents($this->keyFile, $pem);
        config()->set('services.swaps', ['enabled' => true, 'api_key' => 'test-key', 'private_key_path' => $this->keyFile, 'treasury_url' => '', 'treasury_token' => '']);
        DB::table('ReceivingWallet')->insert([
            ['id' => 'xrp-wallet', 'assetKey' => 'XRP', 'label' => 'XRP fixture', 'address' => 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 'destinationTag' => '123'],
            ['id' => 'sol-wallet', 'assetKey' => 'SOL', 'label' => 'SOL fixture', 'address' => 'So11111111111111111111111111111111111111112', 'destinationTag' => null],
        ]);
        DB::table('SwapAsset')->insert([
            ['assetKey' => 'XRP', 'providerTicker' => 'xrp', 'walletId' => 'xrp-wallet', 'isActive' => true],
            ['assetKey' => 'SOL', 'providerTicker' => 'sol', 'walletId' => 'sol-wallet', 'isActive' => true],
        ]);
        DB::transaction(function () {
            CryptoSwaps::account('user');
            CryptoFunds::move(CryptoFunds::balance('user', 'XRP'), '500000000', '0', 'DEPOSIT', '500000000', 'TEST-SEED');
        });
        Http::fake(['api.changelly.com/*' => function (Request $request) {
            $body = $request->data();
            $public = openssl_pkey_get_details(openssl_pkey_get_private(file_get_contents($this->keyFile)))['key'];
            $this->assertSame(1, openssl_verify($request->body(), base64_decode($request->header('X-Api-Signature')[0]), $public, OPENSSL_ALGO_SHA256));
            $params = $body['params'];
            $result = match ($body['method']) {
                'getCurrenciesFull' => array_map(fn ($asset) => ['ticker' => $asset, 'enabled' => ! in_array($asset, $this->disabled), 'fixRateEnabled' => true, 'enabledFrom' => true, 'enabledTo' => true], ['xrp', 'sol']),
                'getPairsParams' => [['from' => $params[0]['from'], 'to' => $params[0]['to'], 'minAmountFixed' => '1', 'maxAmountFixed' => '1000000']],
                'getFixRateForAmount' => [['id' => 'rate-'.bin2hex(random_bytes(4)), 'from' => $params[0]['from'], 'to' => $params[0]['to'], 'amountFrom' => $params[0]['amountFrom'], 'amountTo' => '2.000000001', 'networkFee' => '0.001', 'expiredAt' => now()->addMinute()->timestamp]],
                'createFixTransaction' => $this->createOrder($params),
                'getTransactions' => isset($this->orders[$params['id']]) ? [$this->orders[$params['id']]] : [],
                default => throw new \RuntimeException('Unexpected provider method'),
            };
            if ($body['method'] === 'createFixTransaction' && $this->createMode === 'uncertain') {
                return Http::response('upstream unavailable', 502);
            }
            if ($body['method'] === 'createFixTransaction' && $this->createMode === 'rejected') {
                return Http::response(['jsonrpc' => '2.0', 'id' => $body['id'], 'error' => ['code' => -32602]]);
            }

            return Http::response(['jsonrpc' => '2.0', 'id' => $body['id'], 'result' => $result]);
        }]);
    }

    protected function tearDown(): void
    {
        if (isset($this->keyFile)) {
            @unlink($this->keyFile);
        }
        parent::tearDown();
    }

    private function createOrder(array $params): array
    {
        $this->createdOrders++;
        $row = [
            'id' => 'order-'.$this->createdOrders, 'type' => 'fixed', 'status' => 'waiting',
            'currencyFrom' => $params['from'], 'currencyTo' => $params['to'],
            'payoutAddress' => $params['address'], 'payoutExtraId' => $params['extraId'] ?? null,
            'refundAddress' => $params['refundAddress'], 'refundExtraId' => $params['refundExtraId'] ?? null,
            'payinAddress' => 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 'payinExtraId' => '987',
            'amountExpectedFrom' => $params['amountFrom'], 'amountExpectedTo' => '2.001000001', 'networkFee' => '0.001',
            'payTill' => now()->addMinutes(10)->toIso8601String(), 'moneyReceived' => 0,
        ];
        $this->orders[$row['id']] = $row;

        return $row;
    }

    private function swapQuote(string $quantity = '100'): array
    {
        return $this->withUnencryptedCookie('qfs_session', $this->swapUser)->postJson('/api/wallet/swaps/quote', ['fromAsset' => 'XRP', 'toAsset' => 'SOL', 'quantity' => $quantity])->assertOk()->json('data');
    }

    private function startSwap(string $reference = 'SWAP-test'): array
    {
        $quote = $this->swapQuote();

        return $this->withUnencryptedCookie('qfs_session', $this->swapUser)->postJson('/api/wallet/swaps', ['quoteId' => $quote['id'], 'reference' => $reference])->assertOk()->json('data');
    }

    public function test_swap_reserves_crypto_once_and_settles_actual_output_exactly_once(): void
    {
        $quote = $this->swapQuote();
        $this->assertSame('2.000000001', $quote['receiveQuantity']);
        $payload = ['quoteId' => $quote['id'], 'reference' => 'SWAP-once'];
        $reply = $this->withUnencryptedCookie('qfs_session', $this->swapUser)->postJson('/api/wallet/swaps', $payload)->assertOk()->assertJsonPath('data.status', 'AWAITING_FUNDING');
        $id = $reply->json('data.id');
        $this->assertSame('100000000', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('reservedAtomic'));
        $this->assertSame(1, $this->createdOrders);
        $this->withUnencryptedCookie('qfs_session', $this->swapUser)->postJson('/api/wallet/swaps', $payload)->assertOk()->assertJsonPath('data.id', $id);
        $this->assertSame(1, $this->createdOrders);
        $this->orders['order-1'] += ['amountFrom' => '100', 'amountTo' => '2.000000002', 'payoutHash' => str_repeat('2', 88)];
        $this->orders['order-1']['status'] = 'finished';
        CryptoSwaps::sync($id);
        CryptoSwaps::sync($id);
        $this->assertSame('400000000', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('totalAtomic'));
        $this->assertSame('0', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('reservedAtomic'));
        $this->assertSame('2000000002', DB::table('CryptoBalance')->where('assetKey', 'SOL')->value('totalAtomic'));
        $this->assertSame(1, DB::table('Transaction')->where('type', 'SWAP')->count());
        $this->assertSame(10000, DB::table('Account')->value('balanceCents'));
        $this->withUnencryptedCookie('qfs_session', $this->swapUser)->getJson('/api/transactions')->assertOk()->assertJsonPath('data.items.0.amount', '100 XRP → 2.000000002 SOL');
        $this->assertSame(1, DB::table('CryptoTransferClaim')->count());
    }

    public function test_expired_used_foreign_and_changed_quotes_cannot_spend_funds(): void
    {
        $quote = $this->swapQuote();
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/wallet/swaps', ['quoteId' => $quote['id'], 'reference' => 'foreign'])->assertStatus(404);
        DB::table('Account')->insert(['id' => 'admin-account', 'userId' => 'admin', 'balanceCents' => 0, 'availableCents' => 0]);
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/wallet/swaps', ['quoteId' => $quote['id'], 'reference' => 'foreign'])->assertStatus(409);
        DB::table('SwapQuote')->where('id', $quote['id'])->update(['expiresAt' => now()->subMinute()]);
        $this->withUnencryptedCookie('qfs_session', $this->swapUser)->postJson('/api/wallet/swaps', ['quoteId' => $quote['id'], 'reference' => 'expired'])->assertStatus(409);
        $swap = $this->startSwap();
        $this->withUnencryptedCookie('qfs_session', $this->swapUser)->postJson('/api/wallet/swaps', ['quoteId' => DB::table('CryptoSwap')->value('quoteId'), 'reference' => 'reuse'])->assertStatus(409);
        $this->assertSame('100000000', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('reservedAtomic'));
    }

    public function test_reserved_funds_cannot_be_reused_and_disabled_assets_cannot_be_quoted(): void
    {
        $this->startSwap();
        $this->withUnencryptedCookie('qfs_session', $this->swapUser)->postJson('/api/wallet/swaps/quote', ['fromAsset' => 'XRP', 'toAsset' => 'SOL', 'quantity' => '401'])->assertStatus(400);
        $this->disabled = ['sol'];
        $this->withUnencryptedCookie('qfs_session', $this->swapUser)->postJson('/api/wallet/swaps/quote', ['fromAsset' => 'XRP', 'toAsset' => 'SOL', 'quantity' => '1'])->assertStatus(409);
        $this->assertSame(1, $this->createdOrders);
    }

    public function test_uncertain_creation_keeps_reservation_and_can_recover_without_creating_another_order(): void
    {
        $this->createMode = 'uncertain';
        $swap = $this->startSwap();
        $this->assertSame('NEEDS_REVIEW', $swap['status']);
        $this->assertSame('100000000', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('reservedAtomic'));
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/admin/swaps/'.$swap['id'], ['action' => 'RECOVER', 'providerId' => 'order-1'])->assertOk()->assertJsonPath('data.status', 'AWAITING_FUNDING');
        $this->assertSame(1, $this->createdOrders);
        $this->assertSame('987', DB::table('CryptoSwap')->value('payinTag'));
    }

    public function test_definitive_creation_rejection_releases_only_its_reservation(): void
    {
        $this->createMode = 'rejected';
        $swap = $this->startSwap();
        $this->assertSame('CANCELLED', $swap['status']);
        $this->assertSame('0', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('reservedAtomic'));
        $this->assertSame('500000000', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('totalAtomic'));
    }

    public function test_funding_attempt_prevents_expiry_from_releasing_possibly_sent_funds(): void
    {
        $swap = $this->startSwap();
        $this->withUnencryptedCookie('qfs_session', $this->swapUser)->postJson('/api/admin/swaps/'.$swap['id'], ['action' => 'BEGIN_FUNDING'])->assertForbidden();
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/admin/swaps/'.$swap['id'], ['action' => 'BEGIN_FUNDING'])->assertOk()->assertJsonPath('data.status', 'FUNDING');
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/admin/swaps/'.$swap['id'], ['action' => 'BEGIN_FUNDING'])->assertStatus(409);
        $this->orders['order-1']['status'] = 'expired';
        CryptoSwaps::sync($swap['id']);
        $this->assertSame('NEEDS_REVIEW', DB::table('CryptoSwap')->value('status'));
        $this->assertSame('100000000', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('reservedAtomic'));
    }

    public function test_unfunded_expired_order_can_safely_release_and_short_payout_cannot_be_credited(): void
    {
        $first = $this->startSwap();
        $this->orders['order-1']['status'] = 'expired';
        CryptoSwaps::sync($first['id']);
        $this->assertSame('CANCELLED', DB::table('CryptoSwap')->where('id', $first['id'])->value('status'));
        $second = $this->startSwap('SWAP-second');
        $this->orders['order-2'] += ['amountFrom' => '100', 'amountTo' => '1', 'payoutHash' => str_repeat('2', 88)];
        $this->orders['order-2']['status'] = 'finished';
        CryptoSwaps::sync($second['id']);
        $this->assertSame('NEEDS_REVIEW', DB::table('CryptoSwap')->where('id', $second['id'])->value('status'));
        $this->assertSame(0, DB::table('CryptoBalance')->where('assetKey', 'SOL')->count());
    }

    public function test_provider_refund_requires_admin_verification_and_records_actual_return_instead_of_assuming_full_refund(): void
    {
        $swap = $this->startSwap();
        $this->orders['order-1']['status'] = 'refunded';
        $this->orders['order-1']['refundHash'] = str_repeat('f', 64);
        CryptoSwaps::sync($swap['id']);
        $this->assertSame('100000000', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('reservedAtomic'));
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/admin/swaps/'.$swap['id'], ['action' => 'REFUND', 'quantity' => '99'])->assertStatus(400);
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/admin/swaps/'.$swap['id'], ['action' => 'REFUND', 'quantity' => '99', 'verified' => true])->assertOk()->assertJsonPath('data.status', 'REFUNDED');
        $this->assertSame('499000000', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('totalAtomic'));
        $this->assertSame('0', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('reservedAtomic'));
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/admin/swaps/'.$swap['id'], ['action' => 'REFUND', 'quantity' => '99', 'verified' => true])->assertStatus(409);
    }

    public function test_automatic_treasury_reconciles_an_uncertain_response_without_sending_a_second_payment(): void
    {
        config()->set('services.swaps.treasury_url', 'https://signer.test');
        config()->set('services.swaps.treasury_token', 'test-only');
        Http::fake(['signer.test/*' => Http::response('', 504)]);
        $swap = $this->startSwap();
        $this->assertSame('NEEDS_REVIEW', $swap['status']);
        $this->artisan('swaps:reconcile')->assertSuccessful();
        Http::assertSentCount(7);
        $puts = collect(Http::recorded())->filter(fn ($pair) => $pair[0]->method() === 'PUT');
        $this->assertCount(1, $puts);
        $this->assertSame('987', $puts->first()[0]->data()['destinationTag']);
        $this->assertSame('100000000', $puts->first()[0]->data()['quantityAtomic']);
    }

    public function test_receipt_claim_blocks_deposit_reuse_and_failed_settlement_does_not_partially_debit(): void
    {
        $swap = $this->startSwap();
        $hash = str_repeat('2', 88);
        $key = CryptoAssets::txKey('SOL', $hash);
        DB::table('CryptoTransferClaim')->insert(['chainTxKey' => $key, 'reference' => 'OTHER']);
        $this->orders['order-1'] += ['amountFrom' => '100', 'amountTo' => '2.000000001', 'payoutHash' => $hash];
        $this->orders['order-1']['status'] = 'finished';
        CryptoSwaps::sync($swap['id']);
        $this->assertSame('500000000', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('totalAtomic'));
        $this->assertSame('100000000', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('reservedAtomic'));
        $this->assertSame(0, DB::table('CryptoBalance')->where('assetKey', 'SOL')->count());
        $this->assertSame('NEEDS_REVIEW', DB::table('CryptoSwap')->value('status'));
    }

    public function test_xrp_and_solana_validation_preserves_case_and_network_precision(): void
    {
        $this->assertSame('rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', CryptoAssets::address('XRP', 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'));
        $this->assertSame('So11111111111111111111111111111111111111112', CryptoAssets::address('SOL', 'So11111111111111111111111111111111111111112'));
        $this->assertSame('1', CryptoAssets::units('SOL', '0.000000001'));
        $this->assertSame('1', CryptoAssets::units('XRP', '0.000001'));
        $this->assertSame('0', CryptoAssets::destinationTag('XRP', '0'));
        $this->assertSame('4294967295', CryptoAssets::destinationTag('XRP', '4294967295'));
        $this->assertFalse(SwapProvider::matches('USDT_BEP20', ['ticker' => 'usdt', 'blockchain' => 'ethereum', 'contractAddress' => '0x'.str_repeat('1', 40)]));
        $this->assertTrue(SwapProvider::matches('USDT_TRC20', ['ticker' => 'usdttrc20', 'blockchain' => 'tron', 'contractAddress' => 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t']));
        $this->assertTrue(SwapProvider::matches('USDT_BEP20', ['ticker' => 'usdtbsc', 'network' => 'bsc', 'contractAddress' => CryptoAssets::get('USDT_BEP20')['token']]));
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/admin/receiving-wallets', ['assetKey' => 'XRP', 'address' => 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTz', 'label' => 'Invalid'])->assertStatus(400);
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/admin/receiving-wallets', ['assetKey' => 'XRP', 'address' => 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 'destinationTag' => '4294967296', 'label' => 'Invalid'])->assertStatus(400);
    }

    public function test_deposit_instructions_keep_xrp_tags_and_solana_signatures_keep_their_case(): void
    {
        $this->withUnencryptedCookie('qfs_session', $this->swapUser)
            ->postJson('/api/wallet/deposits', ['walletId' => 'xrp-wallet', 'quantity' => '1', 'reference' => 'DEP-xrp-tag'])
            ->assertOk()->assertJsonPath('data.request.destinationTag', '123');
        $reply = $this->withUnencryptedCookie('qfs_session', $this->swapUser)
            ->postJson('/api/wallet/deposits', ['walletId' => 'sol-wallet', 'quantity' => '0.000000001', 'reference' => 'DEP-sol-case'])->assertOk();
        $hash = '2Aa'.str_repeat('2', 85);
        $this->withUnencryptedCookie('qfs_session', $this->swapUser)
            ->patchJson('/api/wallet/deposits/'.$reply->json('data.request.id'), ['txHash' => $hash])->assertOk();
        $this->assertSame($hash, DB::table('DepositRequest')->where('reference', 'DEP-sol-case')->value('txHash'));
        $this->assertSame('1', DB::table('DepositRequest')->where('reference', 'DEP-sol-case')->value('quantityAtomic'));
    }

    public function test_route_configuration_checks_admin_access_and_exact_asset_network_mapping(): void
    {
        $payload = ['assetKey' => 'SOL', 'walletId' => 'sol-wallet', 'providerTicker' => 'sol', 'isActive' => true];
        $this->withUnencryptedCookie('qfs_session', $this->swapUser)->putJson('/api/admin/swaps/configuration', $payload)->assertForbidden();
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->putJson('/api/admin/swaps/configuration', [...$payload, 'providerTicker' => 'xrp'])->assertStatus(400);
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->putJson('/api/admin/swaps/configuration', $payload)->assertOk();
        $quote = $this->swapQuote();
        DB::table('ReceivingWallet')->where('id', 'sol-wallet')->update(['isActive' => false]);
        $this->withUnencryptedCookie('qfs_session', $this->swapUser)->postJson('/api/wallet/swaps', ['quoteId' => $quote['id'], 'reference' => 'retired-wallet'])->assertStatus(409);
        $this->assertSame('0', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('reservedAtomic'));
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->putJson('/api/admin/swaps/configuration', [...$payload, 'isActive' => false])->assertOk();
        $this->withUnencryptedCookie('qfs_session', $this->swapUser)->getJson('/api/wallet/swaps')->assertOk()
            ->assertJsonMissingPath('data.api_key')->assertJsonMissingPath('data.private_key_path');
    }

    public function test_distinct_provider_orders_can_settle_in_one_batch_without_allowing_manual_deposit_reuse(): void
    {
        $first = $this->startSwap('SWAP-batch-1');
        $second = $this->startSwap('SWAP-batch-2');
        $hash = str_repeat('2', 88);
        foreach (['order-1' => $first['id'], 'order-2' => $second['id']] as $orderId => $id) {
            $this->orders[$orderId] += ['amountFrom' => '100', 'amountTo' => '2.000000001', 'payoutHash' => $hash];
            $this->orders[$orderId]['status'] = 'finished';
            CryptoSwaps::sync($id);
            CryptoSwaps::sync($id);
        }
        $this->assertSame(2, DB::table('CryptoSwap')->where('status', 'COMPLETED')->count());
        $this->assertSame('300000000', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('totalAtomic'));
        $this->assertSame('4000000002', DB::table('CryptoBalance')->where('assetKey', 'SOL')->value('totalAtomic'));
        $this->assertSame(1, DB::table('CryptoTransferClaim')->count());
        $deposit = $this->withUnencryptedCookie('qfs_session', $this->swapUser)->postJson('/api/wallet/deposits', [
            'walletId' => 'sol-wallet', 'quantity' => '4.000000002', 'reference' => 'DEP-batch-reuse',
        ])->assertOk();
        $this->withUnencryptedCookie('qfs_session', $this->swapUser)->patchJson('/api/wallet/deposits/'.$deposit->json('data.request.id'), ['txHash' => $hash])->assertStatus(409);
    }

    public function test_expired_manual_funding_can_be_released_only_after_provider_and_admin_verify_no_payment(): void
    {
        $swap = $this->startSwap();
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/admin/swaps/'.$swap['id'], ['action' => 'BEGIN_FUNDING'])->assertOk();
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/admin/swaps/'.$swap['id'], ['action' => 'RELEASE_UNFUNDED', 'verified' => true])->assertStatus(409);
        $this->orders['order-1']['status'] = 'expired';
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/admin/swaps/'.$swap['id'], ['action' => 'RELEASE_UNFUNDED'])->assertStatus(400);
        $this->orders['order-1']['moneyReceived'] = now()->timestamp;
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/admin/swaps/'.$swap['id'], ['action' => 'RELEASE_UNFUNDED', 'verified' => true])->assertStatus(409);
        $this->orders['order-1']['moneyReceived'] = 0;
        $this->withUnencryptedCookie('qfs_session', $this->swapAdmin)->postJson('/api/admin/swaps/'.$swap['id'], ['action' => 'RELEASE_UNFUNDED', 'verified' => true])->assertOk()->assertJsonPath('data.status', 'CANCELLED');
        $this->assertSame('0', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('reservedAtomic'));
        $this->assertSame(1, DB::table('AuditLog')->where('action', 'SWAP.VERIFIED_UNFUNDED')->count());
    }

    public function test_irrevocable_signer_not_sent_result_can_release_after_provider_expiry(): void
    {
        config()->set('services.swaps.treasury_url', 'https://signer.test');
        config()->set('services.swaps.treasury_token', 'test-only');
        Http::fake(['signer.test/*' => fn (Request $request) => Http::response([
            ...$request->data(), 'status' => 'NOT_SENT', 'txHash' => null,
        ])]);
        $swap = $this->startSwap();
        $this->assertSame('NEEDS_REVIEW', $swap['status']);
        $this->assertNull(DB::table('CryptoSwap')->value('fundingAttemptAt'));
        $this->orders['order-1']['status'] = 'expired';
        $this->artisan('swaps:reconcile')->assertSuccessful();
        $this->assertSame('CANCELLED', DB::table('CryptoSwap')->value('status'));
        $this->assertSame('0', DB::table('CryptoBalance')->where('assetKey', 'XRP')->value('reservedAtomic'));
    }
}
