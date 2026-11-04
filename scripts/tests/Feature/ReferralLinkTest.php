<?php

namespace Tests\Feature;

use App\Support\Qfs;
use Illuminate\Support\Facades\Config;
use Tests\TestCase;

class ReferralLinkTest extends TestCase
{
    public function test_register_short_url_redirects_with_query_string(): void
    {
        $this->get('/register?ref=INVITE123')
            ->assertRedirect('/user/user/register?ref=INVITE123');
    }

    public function test_referral_register_url_uses_public_base_and_register_path(): void
    {
        Config::set('qfs.public_url', 'https://example.test');

        $this->assertSame(
            'https://example.test/register?ref=ABC123',
            Qfs::referralRegisterUrl('abc123')
        );
    }
}
