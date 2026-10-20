<?php

use App\Support\Qfs;
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
        Schema::table('ReferralEarning', function (Blueprint $table) {
            $table->string('investmentId')->nullable()->change();
            $table->string('depositRequestId')->nullable()->unique();
            $table->integer('baseAmountCents')->nullable();
            $table->integer('rateBps')->nullable();
            $table->text('valuation')->nullable();
            $table->index(['status', 'createdAt']);
        });
        $existingId = DB::table('Setting')->where('key', 'referral_rate_bps')->value('id');
        DB::table('Setting')->updateOrInsert(['key' => 'referral_rate_bps'],
            ['id' => $existingId ?: Qfs::id(), 'value' => '500', 'updatedAt' => now()]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('ReferralEarning', function (Blueprint $table) {
            $table->dropIndex(['status', 'createdAt']);
            $table->dropUnique(['depositRequestId']);
            $table->dropColumn(['depositRequestId', 'baseAmountCents', 'rateBps', 'valuation']);
        });
    }
};
