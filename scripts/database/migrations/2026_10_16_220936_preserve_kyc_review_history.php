<?php

use App\Support\KycHistory;
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
        Schema::create('KycRevision', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('submissionId');
            $table->foreign('submissionId')->references('id')->on('KycSubmission')->cascadeOnDelete();
            $table->integer('version');
            $table->string('event');
            $table->string('actorId')->nullable();
            $table->text('snapshot');
            $table->timestamp('createdAt')->useCurrent();
            $table->unique(['submissionId', 'version']);
        });
        Schema::create('KycArchivedFile', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('submissionId');
            $table->foreign('submissionId')->references('id')->on('KycSubmission')->cascadeOnDelete();
            $table->string('kind');
            $table->string('storagePath')->unique();
            $table->string('mimeType');
            $table->integer('size');
            $table->timestamp('createdAt')->useCurrent();
        });
        DB::table('KycSubmission')->whereNotNull('submittedAt')->orderBy('id')->chunk(100, function ($rows) {
            foreach ($rows as $row) {
                KycHistory::capture($row, 'BASELINE', null);
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('KycRevision');
        Schema::dropIfExists('KycArchivedFile');
    }
};
