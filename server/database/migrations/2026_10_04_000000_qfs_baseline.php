<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('User', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('email');
            $table->string('passwordHash');
            $table->string('name');
            $table->string('phone')->nullable();
            $table->string('role', 30)->default('USER');
            $table->string('status', 30)->default('ACTIVE');
            $table->string('country')->default('United States');
            $table->string('avatarUrl', 2048)->default('/avatars/avatar1.jpg');
            $table->string('referralCode');
            $table->string('referredById')->nullable();
            $table->integer('kycLevel')->default(0);
            $table->dateTime('memberSince', 3)->useCurrent();
            $table->dateTime('lastLoginAt', 3)->nullable();
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->dateTime('updatedAt', 3);
            $table->unique(['email']);
            $table->unique(['referralCode']);
            $table->index(['status']);
        });

        Schema::create('Session', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('tokenHash');
            $table->dateTime('expiresAt', 3);
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->unique(['tokenHash']);
            $table->index(['userId']);
        });

        Schema::create('Account', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->integer('balanceCents')->default(0);
            $table->integer('availableCents')->default(0);
            $table->string('currency')->default('USD');
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->dateTime('updatedAt', 3);
            $table->unique(['userId']);
            $table->index(['userId']);
        });

        Schema::create('LedgerEntry', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('accountId');
            $table->string('movement', 30);
            $table->integer('amountCents');
            $table->integer('balanceAfterCents');
            $table->string('txId')->nullable();
            $table->longText('note')->nullable();
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->index(['accountId', 'createdAt']);
        });

        Schema::create('Transaction', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('type', 30);
            $table->integer('amountCents');
            $table->integer('feeCents')->default(0);
            $table->string('currency')->default('USD');
            $table->string('status', 30)->default('COMPLETED');
            $table->string('method')->nullable();
            $table->string('reference');
            $table->longText('note')->nullable();
            $table->longText('adminNote')->nullable();
            $table->longText('meta')->nullable();
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->dateTime('completedAt', 3)->nullable();
            $table->unique(['reference']);
            $table->index(['userId', 'createdAt']);
            $table->index(['type', 'status']);
        });

        Schema::create('DepositRequest', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->integer('amountCents');
            $table->string('method');
            $table->string('reference');
            $table->string('status', 30)->default('PENDING');
            $table->string('walletAddress')->nullable();
            $table->string('reviewedById')->nullable();
            $table->dateTime('reviewedAt', 3)->nullable();
            $table->longText('adminNote')->nullable();
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->string('transactionId')->nullable();
            $table->unique(['reference']);
            $table->unique(['transactionId']);
            $table->index(['status', 'createdAt']);
        });

        Schema::create('WithdrawalRequest', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->integer('amountCents');
            $table->string('method');
            $table->longText('details')->nullable();
            $table->string('reference');
            $table->string('status', 30)->default('PENDING');
            $table->string('walletAddress')->nullable();
            $table->string('reviewedById')->nullable();
            $table->dateTime('reviewedAt', 3)->nullable();
            $table->longText('adminNote')->nullable();
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->string('transactionId')->nullable();
            $table->unique(['reference']);
            $table->unique(['transactionId']);
            $table->index(['status', 'createdAt']);
        });

        Schema::create('InvestmentPlan', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('name');
            $table->longText('description')->nullable();
            $table->integer('minAmountCents');
            $table->integer('maxAmountCents')->nullable();
            $table->integer('monthlyRoiBps');
            $table->integer('termMonths');
            $table->boolean('isActive')->default(true);
            $table->integer('sort')->default(0);
            $table->string('color')->default('lime');
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->dateTime('updatedAt', 3);
            $table->unique(['name']);
        });

        Schema::create('Investment', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('planId');
            $table->integer('amountCents');
            $table->string('status', 30)->default('ACTIVE');
            $table->dateTime('startDate', 3)->useCurrent();
            $table->dateTime('endDate', 3)->nullable();
            $table->integer('paidOutCents')->default(0);
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->index(['userId', 'status']);
            $table->index(['status']);
        });

        Schema::create('ReferralEarning', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('referrerId');
            $table->string('referredUserId');
            $table->string('investmentId');
            $table->integer('amountCents');
            $table->string('status')->default('PAID');
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->unique(['investmentId']);
            $table->index(['referrerId']);
        });

        Schema::create('Loan', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('type');
            $table->string('currency')->default('USD');
            $table->integer('amountCents');
            $table->integer('period')->default(12);
            $table->longText('occupation')->nullable();
            $table->integer('aprBps')->default(950);
            $table->string('status', 30)->default('PENDING');
            $table->dateTime('dueDate', 3)->nullable();
            $table->string('decidedById')->nullable();
            $table->dateTime('decidedAt', 3)->nullable();
            $table->longText('adminNote')->nullable();
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->index(['status', 'createdAt']);
        });

        Schema::create('Card', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('brand');
            $table->string('last4');
            $table->string('expiry');
            $table->string('holder');
            $table->string('status', 30)->default('ACTIVE');
            $table->boolean('isDefault')->default(false);
            $table->string('color')->default('black');
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->index(['userId']);
        });

        Schema::create('WalletNonce', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('nonce');
            $table->longText('message');
            $table->dateTime('expiresAt', 3);
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->index(['expiresAt']);
            $table->unique(['userId', 'nonce']);
        });

        Schema::create('WalletConnection', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('address');
            $table->integer('chainId')->default(1);
            $table->string('label')->default('');
            $table->dateTime('lastUsedAt', 3)->useCurrent();
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->index(['userId']);
            $table->index(['address']);
            $table->unique(['userId', 'address']);
        });

        Schema::create('Notification', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('title');
            $table->longText('body')->nullable();
            $table->string('link')->nullable();
            $table->dateTime('readAt', 3)->nullable();
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->index(['userId', 'readAt']);
        });

        Schema::create('Document', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('code');
            $table->string('title');
            $table->longText('flagPath');
            $table->longText('fileUrl');
            $table->integer('sort')->default(0);
            $table->boolean('isActive')->default(true);
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->unique(['code']);
        });

        Schema::create('Review', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userName');
            $table->string('avatarUrl', 2048)->default('/avatars/avatar1.jpg');
            $table->string('country')->default('');
            $table->integer('rating')->default(5);
            $table->longText('text');
            $table->string('status')->default('APPROVED');
            $table->integer('sort')->default(0);
            $table->dateTime('createdAt', 3)->useCurrent();
        });

        Schema::create('MarketAsset', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('symbol');
            $table->string('name');
            $table->string('full');
            $table->string('type', 30);
            $table->string('price');
            $table->string('change');
            $table->string('direction')->default('up');
            $table->string('color')->default('#2b2b3a');
            $table->integer('sort')->default(0);
            $table->boolean('isActive')->default(true);
            $table->unique(['symbol']);
        });

        Schema::create('AuditLog', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('actorId');
            $table->string('actorRole');
            $table->string('action');
            $table->string('targetType');
            $table->string('targetId')->nullable();
            $table->longText('meta')->nullable();
            $table->string('ip')->nullable();
            $table->dateTime('createdAt', 3)->useCurrent();
            $table->index(['createdAt']);
        });

        Schema::create('Setting', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('key');
            $table->longText('value');
            $table->dateTime('updatedAt', 3);
            $table->unique(['key']);
        });

        Schema::table('User', function (Blueprint $table) {
            $table->foreign('referredById')->references('id')->on('User')->onDelete('set null')->cascadeOnUpdate();
        });
        Schema::table('Session', function (Blueprint $table) {
            $table->foreign('userId')->references('id')->on('User')->onDelete('cascade')->cascadeOnUpdate();
        });
        Schema::table('Account', function (Blueprint $table) {
            $table->foreign('userId')->references('id')->on('User')->onDelete('cascade')->cascadeOnUpdate();
        });
        Schema::table('LedgerEntry', function (Blueprint $table) {
            $table->foreign('txId')->references('id')->on('Transaction')->onDelete('set null')->cascadeOnUpdate();
        });
        Schema::table('LedgerEntry', function (Blueprint $table) {
            $table->foreign('accountId')->references('id')->on('Account')->onDelete('cascade')->cascadeOnUpdate();
        });
        Schema::table('Transaction', function (Blueprint $table) {
            $table->foreign('userId')->references('id')->on('User')->onDelete('cascade')->cascadeOnUpdate();
        });
        Schema::table('DepositRequest', function (Blueprint $table) {
            $table->foreign('userId')->references('id')->on('User')->onDelete('cascade')->cascadeOnUpdate();
        });
        Schema::table('DepositRequest', function (Blueprint $table) {
            $table->foreign('transactionId')->references('id')->on('Transaction')->onDelete('set null')->cascadeOnUpdate();
        });
        Schema::table('WithdrawalRequest', function (Blueprint $table) {
            $table->foreign('userId')->references('id')->on('User')->onDelete('cascade')->cascadeOnUpdate();
        });
        Schema::table('WithdrawalRequest', function (Blueprint $table) {
            $table->foreign('transactionId')->references('id')->on('Transaction')->onDelete('set null')->cascadeOnUpdate();
        });
        Schema::table('Investment', function (Blueprint $table) {
            $table->foreign('userId')->references('id')->on('User')->onDelete('cascade')->cascadeOnUpdate();
        });
        Schema::table('Investment', function (Blueprint $table) {
            $table->foreign('planId')->references('id')->on('InvestmentPlan')->onDelete('restrict')->cascadeOnUpdate();
        });
        Schema::table('ReferralEarning', function (Blueprint $table) {
            $table->foreign('referrerId')->references('id')->on('User')->onDelete('cascade')->cascadeOnUpdate();
        });
        Schema::table('ReferralEarning', function (Blueprint $table) {
            $table->foreign('investmentId')->references('id')->on('Investment')->onDelete('restrict')->cascadeOnUpdate();
        });
        Schema::table('Loan', function (Blueprint $table) {
            $table->foreign('userId')->references('id')->on('User')->onDelete('cascade')->cascadeOnUpdate();
        });
        Schema::table('Card', function (Blueprint $table) {
            $table->foreign('userId')->references('id')->on('User')->onDelete('cascade')->cascadeOnUpdate();
        });
        Schema::table('WalletNonce', function (Blueprint $table) {
            $table->foreign('userId')->references('id')->on('User')->onDelete('cascade')->cascadeOnUpdate();
        });
        Schema::table('WalletConnection', function (Blueprint $table) {
            $table->foreign('userId')->references('id')->on('User')->onDelete('cascade')->cascadeOnUpdate();
        });
        Schema::table('Notification', function (Blueprint $table) {
            $table->foreign('userId')->references('id')->on('User')->onDelete('cascade')->cascadeOnUpdate();
        });
        Schema::table('AuditLog', function (Blueprint $table) {
            $table->foreign('actorId')->references('id')->on('User')->onDelete('cascade')->cascadeOnUpdate();
        });
    }

    public function down(): void
    {
        throw new RuntimeException('Financial records are never removed by a baseline rollback.');
    }
};
