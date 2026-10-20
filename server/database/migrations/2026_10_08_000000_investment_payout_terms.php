<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('InvestmentPlan', function (Blueprint $table) {
            $table->string('payoutInterval')->default('MONTHLY');
        });
        Schema::table('Investment', function (Blueprint $table) {
            $table->integer('monthlyRoiBps')->default(0);
            $table->integer('termMonths')->default(0);
            $table->string('payoutInterval')->default('MONTHLY');
        });
        foreach (DB::table('Investment')->select('id', 'planId')->get() as $investment) {
            $plan = DB::table('InvestmentPlan')->where('id', $investment->planId)->first();
            if ($plan) DB::table('Investment')->where('id', $investment->id)->update([
                'monthlyRoiBps' => $plan->monthlyRoiBps,
                'termMonths' => $plan->termMonths,
            ]);
        }
    }

    public function down(): void
    {
        Schema::table('Investment', function (Blueprint $table) {
            $table->dropColumn(['monthlyRoiBps', 'termMonths', 'payoutInterval']);
        });
        Schema::table('InvestmentPlan', function (Blueprint $table) {
            $table->dropColumn('payoutInterval');
        });
    }
};
