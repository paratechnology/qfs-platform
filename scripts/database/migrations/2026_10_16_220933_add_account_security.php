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
        Schema::table('Session', function (Blueprint $table) {
            $table->string('ipAddress', 45)->nullable();
            $table->string('userAgent', 500)->nullable();
            $table->timestamp('lastSeenAt')->nullable();
        });
        Schema::create('AccountSecurity', function (Blueprint $table) {
            $table->string('userId')->primary();
            $table->foreign('userId')->references('id')->on('User')->cascadeOnDelete();
            $table->text('secret')->nullable();
            $table->text('recoveryHashes')->nullable();
            $table->bigInteger('lastCounter')->default(-1);
            $table->timestamp('enabledAt')->nullable();
            $table->text('pendingSecret')->nullable();
            $table->string('pendingSessionId')->nullable();
            $table->timestamp('pendingExpiresAt')->nullable();
        });
        Schema::create('LoginChallenge', function (Blueprint $table) {
            $table->string('tokenHash')->primary();
            $table->string('userId');
            $table->foreign('userId')->references('id')->on('User')->cascadeOnDelete();
            $table->string('passwordFingerprint');
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamp('expiresAt')->index();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('LoginChallenge');
        Schema::dropIfExists('AccountSecurity');
        Schema::table('Session', fn (Blueprint $table) => $table->dropColumn(['ipAddress', 'userAgent', 'lastSeenAt']));
    }
};
