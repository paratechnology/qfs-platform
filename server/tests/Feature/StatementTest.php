<?php

namespace Tests\Feature;

use App\Support\SessionAuth;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class StatementTest extends TestCase
{
    private string $adminToken;

    private string $userToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withCredentials();
        config()->set('qfs.session_secret', str_repeat('x', 64));
        $this->travelTo(now()->setDate(2026, 10, 16)->startOfDay());
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
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('Account', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->integer('balanceCents')->default(0);
            $t->integer('availableCents')->default(0);
        });
        Schema::create('Transaction', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('type')->default('EARNING');
            $t->string('reference')->unique();
            $t->integer('amountCents')->default(100);
            $t->integer('feeCents')->default(0);
            $t->string('currency')->default('USD');
            $t->string('status')->default('COMPLETED');
            $t->string('assetKey')->nullable();
            $t->string('quantityAtomic')->nullable();
            $t->text('note')->nullable();
            $t->text('meta')->nullable();
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('Investment', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('status')->default('ACTIVE');
            $t->integer('amountCents');
            $t->integer('monthlyRoiBps')->default(1000);
            $t->integer('termMonths')->default(3);
            $t->string('payoutInterval')->default('HOURLY');
            $t->integer('paidOutCents')->default(0);
            $t->timestamp('startDate')->useCurrent();
            $t->timestamp('endDate')->nullable();
            $t->timestamp('principalReturnedAt')->nullable();
        });
        Schema::create('WithdrawalRequest', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('status')->default('PENDING');
            $t->string('assetKey')->nullable();
            $t->string('fundingSource')->nullable();
            $t->integer('amountCents')->default(0);
            $t->string('quantityAtomic')->nullable();
        });
        Schema::create('CryptoSwap', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('status');
            $t->string('fromAsset');
            $t->string('toAsset');
            $t->string('fromAtomic');
        });
        Schema::create('CryptoBalance', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('assetKey');
            $t->string('totalAtomic')->default('0');
            $t->string('reservedAtomic')->default('0');
        });
        Schema::create('CryptoLedger', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('assetKey');
            $t->string('reference');
            $t->string('totalAfterAtomic');
            $t->string('reservedAfterAtomic');
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('LedgerEntry', function (Blueprint $t) {
            $t->string('txId')->nullable();
            $t->string('movement')->nullable();
            $t->string('id')->primary();
            $t->string('accountId');
            $t->integer('balanceAfterCents');
            $t->timestamp('createdAt')->useCurrent();
        });
        foreach (['user', 'admin'] as $id) {
            DB::table('User')->insert(['id' => $id, 'name' => $id, 'email' => $id.'@test.local', 'role' => $id === 'admin' ? 'ADMIN' : 'USER']);
            DB::table('Account')->insert(['id' => $id, 'userId' => $id]);
        }
        $this->userToken = SessionAuth::issue('user');
        $this->adminToken = SessionAuth::issue('admin');
        $this->withUnencryptedCookie('qfs_session', $this->userToken);
    }

    public function test_statements_are_owner_scoped_and_use_inclusive_utc_dates(): void
    {
        foreach ([['first', 'user', '2026-10-01 00:00:00'], ['last', 'user', '2026-10-15 23:59:59'], ['future', 'user', '2026-10-16 00:00:00'], ['private', 'admin', '2026-10-05 00:00:00']] as [$id,$user,$date]) {
            DB::table('Transaction')->insert(['id' => $id, 'userId' => $user, 'reference' => $id, 'createdAt' => $date]);
        }
        $this->getJson('/api/account/statement?from=2026-10-01&to=2026-10-15')->assertOk()->assertJsonPath('data.transactionCount', 2)->assertJsonPath('data.transactions.0.reference', 'first')->assertJsonPath('data.transactions.1.reference', 'last');
        $this->getJson('/api/account/statement?from=2026-10-16&to=2026-10-01')->assertStatus(400);
        $this->getJson('/api/account/statement?from=2024-01-01&to=2026-10-16')->assertStatus(400);
        $this->getJson('/api/account/statement?to=2026-10-17')->assertStatus(400);
        $this->getJson('/api/admin/reconciliation')->assertForbidden();
        $this->withUnencryptedCookie('qfs_session', 'invalid')->getJson('/api/account/statement')->assertUnauthorized();
    }

    public function test_csv_preserves_crypto_precision_swap_receipts_and_escapes_spreadsheet_formulas(): void
    {
        DB::table('User')->where('id', 'user')->update(['name' => '<script>unsafe</script>']);
        DB::table('Transaction')->insert(['id' => 'swap', 'userId' => 'user', 'reference' => '=HYPERLINK("bad")', 'type' => 'SWAP', 'assetKey' => 'XRP', 'quantityAtomic' => '123456789', 'amountCents' => 0, 'note' => '=SUM(1,2)', 'meta' => json_encode(['toAsset' => 'SOL', 'receivedAtomic' => '100000001'])]);
        DB::table('CryptoBalance')->insert(['id' => 'eth', 'userId' => 'user', 'assetKey' => 'ETH', 'totalAtomic' => '9007199254740993123']);
        DB::table('Investment')->insert(['id' => 'inv', 'userId' => 'user', 'amountCents' => 100000]);
        $csv = $this->get('/api/account/statement?format=csv')->assertOk()->assertHeader('Cache-Control', 'no-store, private')->streamedContent();
        $this->assertStringContainsString('9.007199254740993123', $csv);
        $this->assertStringContainsString('123.456789 XRP → 0.100000001 SOL', $csv);
        $this->assertStringContainsString("'=HYPERLINK", $csv);
        $this->assertStringContainsString('CURRENT_INVESTMENT', $csv);
        $print = $this->get('/api/account/statement?format=print')->assertOk()->getContent();
        $this->assertStringNotContainsString('<script>unsafe</script>', $print);
        $this->assertStringContainsString('&lt;script&gt;unsafe&lt;/script&gt;', $print);
        $this->assertStringContainsString('window.print()', $print);
    }

    public function test_preview_limits_do_not_truncate_exports(): void
    {
        $rows = [];
        for ($i = 0; $i < 501; $i++) {
            $rows[] = ['id' => 'tx-'.$i, 'userId' => 'user', 'reference' => 'ref-'.$i];
        }
        DB::table('Transaction')->insert($rows);
        $this->getJson('/api/account/statement')->assertOk()->assertJsonPath('data.transactionCount', 501)->assertJsonPath('data.previewLimited', true)->assertJsonCount(500, 'data.transactions');
        $csv = $this->get('/api/account/statement?format=csv')->assertOk()->streamedContent();
        $this->assertSame(501, substr_count($csv, 'TRANSACTION,'));
    }

    public function test_manual_deductions_are_not_presented_as_credits_on_statements(): void
    {
        DB::table('Transaction')->insert(['id' => 'deduction', 'userId' => 'user', 'reference' => 'ADJ-DEBIT', 'type' => 'ADJUSTMENT', 'amountCents' => 1250]);
        DB::table('LedgerEntry')->insert(['id' => 'deduction-entry', 'accountId' => 'user', 'txId' => 'deduction', 'movement' => 'DEBIT', 'balanceAfterCents' => 0]);
        $this->getJson('/api/account/statement')->assertOk()->assertJsonPath('data.transactions.0.amountCents', -1250)->assertJsonPath('data.transactions.0.displayAmount', '-$12.50');
    }

    public function test_reconciliation_accounts_for_investments_and_both_reservation_types_without_writes(): void
    {
        DB::table('Account')->where('id', 'user')->update(['balanceCents' => 100000, 'availableCents' => 40000]);
        DB::table('Investment')->insert(['id' => 'inv', 'userId' => 'user', 'amountCents' => 50000]);
        DB::table('WithdrawalRequest')->insert(['id' => 'usd', 'userId' => 'user', 'amountCents' => 10000, 'fundingSource' => 'USD', 'assetKey' => 'SOL']);
        DB::table('WithdrawalRequest')->insert(['id' => 'crypto', 'userId' => 'user', 'fundingSource' => 'CRYPTO', 'assetKey' => 'XRP', 'quantityAtomic' => '1000000']);
        DB::table('CryptoSwap')->insert(['id' => 'swap', 'userId' => 'user', 'status' => 'NEEDS_REVIEW', 'fromAsset' => 'XRP', 'toAsset' => 'SOL', 'fromAtomic' => '2000000']);
        DB::table('CryptoBalance')->insert(['id' => 'xrp', 'userId' => 'user', 'assetKey' => 'XRP', 'totalAtomic' => '5000000', 'reservedAtomic' => '3000000']);
        DB::table('CryptoLedger')->insert(['id' => 'cl', 'userId' => 'user', 'assetKey' => 'XRP', 'reference' => 'reserve', 'totalAfterAtomic' => '5000000', 'reservedAfterAtomic' => '3000000']);
        DB::table('LedgerEntry')->insert(['id' => 'l', 'accountId' => 'user', 'balanceAfterCents' => 100000]);
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)->getJson('/api/admin/reconciliation')->assertOk()->assertJsonPath('data.items.1.userId', 'user')->assertJsonCount(0, 'data.items.1.issues');
        DB::table('CryptoBalance')->where('id', 'xrp')->update(['reservedAtomic' => '1']);
        DB::table('Account')->where('id', 'user')->update(['availableCents' => 99999]);
        $before = DB::table('Account')->get()->toJson();
        $crypto = DB::table('CryptoBalance')->get()->toJson();
        $issues = $this->getJson('/api/admin/reconciliation')->assertOk()->json('data.items.1.issues');
        $this->assertContains('USD_RESERVATIONS', array_column($issues, 'code'));
        $this->assertContains('CRYPTO_RESERVATIONS', array_column($issues, 'code'));
        $this->assertContains('CRYPTO_LATEST_LEDGER', array_column($issues, 'code'));
        $this->assertSame($before, DB::table('Account')->get()->toJson());
        $this->assertSame($crypto, DB::table('CryptoBalance')->get()->toJson());
    }

    public function test_completed_swap_missing_settlement_records_is_reported_and_accounts_are_paginated(): void
    {
        DB::table('CryptoSwap')->insert(['id' => 'broken', 'userId' => 'user', 'status' => 'COMPLETED', 'fromAsset' => 'XRP', 'toAsset' => 'SOL', 'fromAtomic' => '1000000']);
        for ($i = 0; $i < 30; $i++) {
            DB::table('User')->insert(['id' => 'z'.$i, 'name' => 'Person', 'email' => 'person'.$i.'@test.local']);
            DB::table('Account')->insert(['id' => 'z'.$i, 'userId' => 'z'.$i]);
        }
        $first = $this->withUnencryptedCookie('qfs_session', $this->adminToken)->getJson('/api/admin/reconciliation')->assertOk()->assertJsonCount(25, 'data.items');
        $this->assertSame(['SWAP_LEDGER_MISSING', 'SWAP_LEDGER_MISSING', 'SWAP_RECEIPT_MISSING'], array_column($first->json('data.items.1.issues'), 'code'));
        $this->getJson('/api/admin/reconciliation?after='.$first->json('data.nextCursor'))->assertOk()->assertJsonCount(7, 'data.items')->assertJsonPath('data.nextCursor', null);
    }
}
