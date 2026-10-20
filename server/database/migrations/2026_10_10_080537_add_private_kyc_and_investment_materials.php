<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('KycSubmission', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId')->unique();
            $table->foreign('userId')->references('id')->on('User')->cascadeOnDelete();
            $table->string('status')->default('DRAFT');
            $table->text('details')->nullable();
            $table->integer('version')->default(1);
            $table->timestamp('submittedAt')->nullable();
            $table->timestamp('consentAt')->nullable();
            $table->timestamp('reviewedAt')->nullable();
            $table->string('reviewedById')->nullable();
            $table->text('reviewNote')->nullable();
            $table->timestamp('createdAt')->useCurrent();
            $table->timestamp('updatedAt')->useCurrent();
            $table->index(['status', 'submittedAt']);
        });
        Schema::create('KycFile', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('submissionId');
            $table->foreign('submissionId')->references('id')->on('KycSubmission')->cascadeOnDelete();
            $table->string('kind');
            $table->string('storagePath');
            $table->string('mimeType');
            $table->integer('size');
            $table->timestamp('createdAt')->useCurrent();
            $table->unique(['submissionId', 'kind']);
        });
        Schema::table('InvestmentPlan', function (Blueprint $table) {
            $table->text('terms')->nullable();
            $table->text('riskDisclosure')->nullable();
            $table->text('documentIds')->default('[]');
        });
        Schema::table('Investment', function (Blueprint $table) {
            $table->text('materials')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('Investment', fn (Blueprint $table) => $table->dropColumn('materials'));
        Schema::table('InvestmentPlan', fn (Blueprint $table) => $table->dropColumn(['terms', 'riskDisclosure', 'documentIds']));
        Schema::dropIfExists('KycFile');
        Schema::dropIfExists('KycSubmission');
    }
};
