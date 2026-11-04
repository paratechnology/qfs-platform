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
        Schema::table('User', function (Blueprint $table) {
            $table->string('locale', 10)->nullable();
        });
        Schema::table('InvestmentPlan', function (Blueprint $table) {
            $table->text('translations')->nullable();
        });
        Schema::table('Notification', function (Blueprint $table) {
            $table->text('messageParams')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('User', fn (Blueprint $table) => $table->dropColumn('locale'));
        Schema::table('InvestmentPlan', fn (Blueprint $table) => $table->dropColumn('translations'));
        Schema::table('Notification', fn (Blueprint $table) => $table->dropColumn('messageParams'));
    }
};
