<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('CryptoSwap', function (Blueprint $t) {
            $t->dropUnique(['payoutTxKey']);
            $t->dropUnique(['refundTxKey']);
            $t->index('payoutTxKey');
            $t->index('refundTxKey');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('CryptoSwap', function (Blueprint $t) {
            $t->dropIndex(['payoutTxKey']);
            $t->dropIndex(['refundTxKey']);
            $t->unique('payoutTxKey');
            $t->unique('refundTxKey');
        });
    }
};
