<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('CryptoTransferClaim', function (Blueprint $t) {
            $t->string('chainTxKey', 120)->primary();
            $t->string('reference')->unique();
        });
        foreach (DB::table('DepositRequest')->whereNotNull('chainTxKey')->get() as $row) {
            DB::table('CryptoTransferClaim')->insertOrIgnore(['chainTxKey' => $row->chainTxKey, 'reference' => 'DEP-'.$row->id]);
        }
        foreach (['ReceivingWallet', 'DepositRequest', 'WithdrawalRequest'] as $name) {
            Schema::table($name, fn (Blueprint $t) => $t->string('destinationTag', 10)->nullable());
        }
        Schema::create('SwapAsset', function (Blueprint $t) {
            $t->string('assetKey', 30)->primary();
            $t->string('providerTicker', 40);
            $t->string('walletId');
            $t->boolean('isActive')->default(false);
            $t->timestamp('updatedAt')->useCurrent();
        });
        Schema::create('SwapQuote', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId')->index();
            $t->string('fromAsset', 30);
            $t->string('toAsset', 30);
            $t->string('fromAtomic', 78);
            $t->string('toAtomic', 78);
            $t->string('networkFee', 80);
            $t->string('providerRateId')->unique();
            $t->text('routing');
            $t->timestamp('expiresAt')->index();
            $t->timestamp('usedAt')->nullable();
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('CryptoSwap', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId')->index();
            $t->string('reference', 80)->unique();
            $t->string('quoteId')->unique();
            $t->string('fromAsset', 30);
            $t->string('toAsset', 30);
            $t->string('fromAtomic', 78);
            $t->string('toAtomic', 78);
            $t->string('receivedAtomic', 78)->nullable();
            $t->string('status', 30)->default('CREATING')->index();
            $t->string('providerId')->nullable()->unique();
            $t->string('providerStatus', 30)->nullable();
            $t->text('routing');
            $t->string('payinAddress', 120)->nullable();
            $t->string('payinTag', 10)->nullable();
            $t->timestamp('payTill')->nullable();
            $t->timestamp('fundingAttemptAt')->nullable();
            $t->string('payinHash', 100)->nullable();
            $t->string('payinTxKey', 120)->nullable()->unique();
            $t->string('payoutHash', 100)->nullable();
            $t->string('payoutTxKey', 120)->nullable()->unique();
            $t->string('refundHash', 100)->nullable();
            $t->string('refundTxKey', 120)->nullable()->unique();
            $t->string('lastError', 250)->nullable();
            $t->timestamp('lastCheckedAt')->nullable();
            $t->timestamp('completedAt')->nullable();
            $t->timestamp('createdAt')->useCurrent();
            $t->timestamp('updatedAt')->useCurrent();
            $t->index(['userId', 'createdAt']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('CryptoSwap');
        Schema::dropIfExists('SwapQuote');
        Schema::dropIfExists('SwapAsset');
        Schema::dropIfExists('CryptoTransferClaim');
        foreach (['ReceivingWallet', 'DepositRequest', 'WithdrawalRequest'] as $name) {
            Schema::table($name, fn (Blueprint $t) => $t->dropColumn('destinationTag'));
        }
    }
};
