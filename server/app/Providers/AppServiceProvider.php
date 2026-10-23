<?php

namespace App\Providers;

use App\Support\SQLiteConnection;
use App\Support\SQLiteSchemaGrammar;
use Illuminate\Database\Connection;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        Connection::resolverFor('sqlite', function ($pdo, $database, $prefix, $config) {
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
