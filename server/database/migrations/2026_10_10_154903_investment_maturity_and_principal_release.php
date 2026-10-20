<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('InvestmentPlan', function (Blueprint $table) {
            $table->string('principalRelease')->default('MANUAL');
        });
        Schema::table('Investment', function (Blueprint $table) {
            $table->string('principalRelease')->default('MANUAL');
            $table->timestamp('maturedAt')->nullable();
            $table->timestamp('principalReturnedAt')->nullable();
        });
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TYPE "TxType" ADD VALUE IF NOT EXISTS \'PRINCIPAL_RETURN\'');
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('Investment', fn (Blueprint $table) => $table->dropColumn(['principalRelease', 'maturedAt', 'principalReturnedAt']));
        Schema::table('InvestmentPlan', fn (Blueprint $table) => $table->dropColumn('principalRelease'));
    }
};
