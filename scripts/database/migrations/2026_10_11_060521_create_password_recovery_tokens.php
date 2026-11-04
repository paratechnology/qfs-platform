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
        Schema::create('PasswordRecoveryToken', function (Blueprint $table) {
            $table->string('userId')->primary();
            $table->foreign('userId')->references('id')->on('User')->cascadeOnDelete();
            $table->string('tokenHash', 64)->unique();
            $table->timestamp('expiresAt')->index();
            $table->timestamp('createdAt')->useCurrent();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('PasswordRecoveryToken');
    }
};
