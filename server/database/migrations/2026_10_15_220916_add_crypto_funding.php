<?php

use App\Support\Qfs;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ReceivingWallet', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('assetKey', 30);
            $t->string('label', 80);
            $t->string('address', 120);
            $t->boolean('isActive')->default(true);
            $t->timestamp('createdAt')->useCurrent();
            $t->timestamp('updatedAt')->useCurrent();
            $t->unique(['assetKey', 'address']);
        });
        Schema::create('CryptoBalance', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->foreign('userId')->references('id')->on('User')->cascadeOnDelete();
            $t->string('assetKey', 30);
            $t->string('totalAtomic', 78)->default('0');
            $t->string('reservedAtomic', 78)->default('0');
            $t->timestamp('updatedAt')->useCurrent();
            $t->unique(['userId', 'assetKey']);
        });
        Schema::create('CryptoLedger', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId')->index();
            $t->string('assetKey', 30);
            $t->string('reference')->unique();
            $t->string('kind', 40);
            $t->string('quantityAtomic', 78);
            $t->string('totalAfterAtomic', 78);
            $t->string('reservedAfterAtomic', 78);
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('CryptoQuote', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId')->index();
            $t->string('purpose', 30);
            $t->string('assetKey', 30);
            $t->string('quantityAtomic', 78);
            $t->integer('amountCents');
            $t->string('rateUsd', 60);
            $t->timestamp('priceAt');
            $t->timestamp('expiresAt')->index();
            $t->timestamp('usedAt')->nullable();
            $t->timestamp('createdAt')->useCurrent();
        });
        foreach (['DepositRequest', 'WithdrawalRequest'] as $name) {
            Schema::table($name, function (Blueprint $t) {
                $t->string('assetKey', 30)->nullable();
                $t->string('quantityAtomic', 78)->nullable();
                $t->string('fundingSource', 10)->nullable();
                $t->string('receivingAddress', 120)->nullable();
                $t->string('txHash', 100)->nullable();
                $t->string('chainTxKey', 120)->nullable()->unique();
                $t->string('quoteId')->nullable()->unique();
            });
        }
        Schema::table('Investment', fn (Blueprint $t) => $t->text('funding')->nullable());
        Schema::table('Transaction', function (Blueprint $t) {
            $t->string('assetKey', 30)->nullable();
            $t->string('quantityAtomic', 78)->nullable();
        });
        foreach (['deposit_btc_address' => 'BTC', 'deposit_eth_address' => 'ETH', 'deposit_usdt_trc20' => 'USDT_TRC20', 'deposit_usdt_bep20' => 'USDT_BEP20'] as $key => $asset) {
            $address = trim((string) DB::table('Setting')->where('key', $key)->value('value'));
            if ($address !== '') {
                DB::table('ReceivingWallet')->insert(['id' => Qfs::id(), 'assetKey' => $asset, 'address' => $address, 'label' => 'Existing receiving wallet']);
            }
        }
    }

    public function down(): void
    {
        Schema::table('Transaction', fn (Blueprint $t) => $t->dropColumn(['assetKey', 'quantityAtomic']));
        Schema::table('Investment', fn (Blueprint $t) => $t->dropColumn('funding'));
        foreach (['DepositRequest', 'WithdrawalRequest'] as $name) {
            Schema::table($name, fn (Blueprint $t) => $t->dropColumn(['assetKey', 'quantityAtomic', 'fundingSource', 'receivingAddress', 'txHash', 'chainTxKey', 'quoteId']));
        }
        foreach (['CryptoQuote', 'CryptoLedger', 'CryptoBalance', 'ReceivingWallet'] as $name) {
            Schema::dropIfExists($name);
        }
    }
};
