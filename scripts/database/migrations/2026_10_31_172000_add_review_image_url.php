<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('Review', function (Blueprint $table) {
            $table->string('imageUrl', 2048)->nullable()->after('avatarUrl');
        });
    }

    public function down(): void
    {
        Schema::table('Review', function (Blueprint $table) {
            $table->dropColumn('imageUrl');
        });
    }
};
