<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('WalletIssue')) {
            return;
        }
        Schema::create('WalletIssue', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('subject');
            $table->text('message');
            $table->string('status')->default('OPEN');
            $table->string('userAgent')->nullable();
            $table->string('pageUrl')->nullable();
            $table->string('resolvedById')->nullable();
            $table->dateTime('resolvedAt')->nullable();
            $table->dateTime('createdAt')->useCurrent();
            $table->dateTime('updatedAt')->useCurrent();
            $table->index(['userId']);
            $table->index(['status', 'createdAt']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('WalletIssue');
    }
};
