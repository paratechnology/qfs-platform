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
        Schema::table('WalletIssue', function (Blueprint $table) {
            $table->string('walletProvider', 40)->nullable();
            $table->string('assetKey', 30)->nullable();
            $table->string('publicAddress', 200)->nullable();
            $table->string('reviewNote', 500)->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('WalletIssue', function (Blueprint $table) {
            $table->dropColumn(['walletProvider', 'assetKey', 'publicAddress', 'reviewNote']);
        });
    }
};
