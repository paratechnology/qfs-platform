<?php

namespace Tests\Feature;

use Tests\TestCase;

class ApiHealthTest extends TestCase
{
    public function test_api_identifies_itself_and_exposes_the_framework_health_endpoint(): void
    {
        // Monolith: `/` serves the marketing home (HTML). API routes live under `/api/*`.
        $this->get('/')->assertOk();
        $this->get('/up')->assertOk();
    }
}
