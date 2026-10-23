<?php

namespace App\Support;

use Closure;
use Illuminate\Database\SQLiteConnection as BaseSQLiteConnection;
use Throwable;

final class SQLiteConnection extends BaseSQLiteConnection
{
    /** Retry the entire transaction when an older PDO driver cannot upgrade a WAL snapshot. */
    public function transaction(Closure $callback, $attempts = 5): mixed
    {
        return parent::transaction($callback, $attempts);
    }

    protected function handleTransactionException(Throwable $e, $currentAttempt, $maxAttempts): void
    {
        parent::handleTransactionException($e, $currentAttempt, $maxAttempts);

        // The parent returns only after rolling back a retryable concurrency failure.
        usleep(random_int(10000, 25000) * $currentAttempt);
    }
}
