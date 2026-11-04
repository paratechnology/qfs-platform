<?php

namespace Tests;

use Illuminate\Foundation\Http\Middleware\PreventRequestsDuringMaintenance;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        if ($this->app->environment('testing') && env('DB_CONNECTION') === 'sqlite') {
            config(['database.default' => 'sqlite']);
            config(['database.connections.sqlite.database' => env('DB_DATABASE', ':memory:')]);
            DB::purge('sqlite');
        }
        $this->withoutMiddleware(PreventRequestsDuringMaintenance::class);
    }
}
