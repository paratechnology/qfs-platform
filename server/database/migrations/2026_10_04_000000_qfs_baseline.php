<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            throw new RuntimeException('QFS requires PostgreSQL. Set DB_CONNECTION=pgsql.');
        }
        if (Schema::hasTable('User')) {
            // The same schema may already have been deployed by Prisma.
            foreach (['Account', 'Session', 'Transaction', 'Investment', 'Loan', 'Setting'] as $table) {
                if (!Schema::hasTable($table)) {
                    throw new RuntimeException("Existing QFS schema is incomplete: {$table} is missing.");
                }
            }
            return;
        }
        DB::unprepared(file_get_contents(database_path('sql/qfs_baseline.sql')));
    }

    public function down(): void
    {
        // Financial records are never removed by a rollback.
        throw new RuntimeException('QFS baseline rollback is intentionally unsupported.');
    }
};
