<?php

namespace App\Providers;

use App\Support\SQLiteSchemaGrammar;
use Illuminate\Database\Connection;
use Illuminate\Database\SQLiteConnection;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        Connection::resolverFor('sqlite', function ($pdo, $database, $prefix, $config) {
            if (PHP_VERSION_ID < 80400) {
                throw new \RuntimeException('Local SQLite requires PHP 8.4+ for immediate transactions.');
            }
            $connection = new SQLiteConnection($pdo, $database, $prefix, $config);
            $connection->setSchemaGrammar(new SQLiteSchemaGrammar($connection));

            return $connection;
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
