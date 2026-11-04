<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        DB::transaction(function () {
            foreach ([
                ['QFS Starter', 10_000, 4_999_900, 1000, 3, 1],
                ['QFS Growth', 5_000_000, 49_999_900, 2500, 6, 2],
                ['QFS Premium', 50_000_000, 100_000_000, 3500, 12, 3],
            ] as [$name, $minimum, $maximum, $rate, $months, $sort]) {
                DB::table('InvestmentPlan')->where('name', $name)->update([
                    'minAmountCents' => $minimum, 'maxAmountCents' => $maximum,
                    'monthlyRoiBps' => $rate, 'termMonths' => $months,
                    'payoutInterval' => 'HOURLY', 'isActive' => true,
                    'sort' => $sort, 'updatedAt' => now('UTC'),
                ]);
            }
            DB::table('InvestmentPlan')->where('name', 'QFS Growth')
                ->where('description', 'Steady growth with monthly payouts.')
                ->update(['description' => 'Six-month plan with hourly profit payouts.']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Business terms and existing investment snapshots are retained on rollback.
    }
};
