<?php

namespace Tests\Feature;

use Tests\TestCase;

class ApiHealthTest extends TestCase
{
    public function test_api_identifies_itself_and_exposes_the_framework_health_endpoint(): void
    {
        $this->getJson('/')->assertOk()->assertExactJson(['service' => 'QFS API']);
        $this->get('/up')->assertOk();
    }
}
