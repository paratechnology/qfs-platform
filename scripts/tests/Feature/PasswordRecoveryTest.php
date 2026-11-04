<?php

namespace Tests\Feature;

use App\Mail\PasswordRecoveryMail;
use App\Support\SessionAuth;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class PasswordRecoveryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->withCredentials();
        config()->set('qfs.session_secret', str_repeat('x', 64));
        config()->set('qfs.public_url', 'https://qfs.test');
        config()->set('mail.default', 'array');
        Mail::fake();
        Schema::create('User', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('email')->unique();
            $t->string('name');
            $t->string('passwordHash');
            $t->string('role')->default('USER');
            $t->string('status')->default('ACTIVE');
            $t->string('avatarUrl')->default('');
            $t->string('country')->default('');
            $t->string('referralCode')->default('');
            $t->integer('kycLevel')->default(0);
            $t->timestamp('memberSince')->useCurrent();
            $t->timestamp('lastLoginAt')->nullable();
            $t->timestamp('updatedAt')->useCurrent();
        });
        Schema::create('Session', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('tokenHash');
            $t->timestamp('expiresAt');
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('Notification', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('title');
            $t->text('body')->nullable();
            $t->text('messageParams')->nullable();
        });
        (require database_path('migrations/2026_10_11_060521_create_password_recovery_tokens.php'))->up();
        (require database_path('migrations/2026_10_16_220933_add_account_security.php'))->up();
        DB::table('User')->insert([
            ['id' => 'user', 'email' => 'user@test.local', 'name' => 'Investor', 'passwordHash' => Hash::make('OriginalPass94'), 'role' => 'USER', 'status' => 'ACTIVE'],
            ['id' => 'admin', 'email' => 'admin@test.local', 'name' => 'Admin', 'passwordHash' => Hash::make('OriginalPass94'), 'role' => 'ADMIN', 'status' => 'ACTIVE'],
            ['id' => 'suspended', 'email' => 'suspended@test.local', 'name' => 'Suspended', 'passwordHash' => Hash::make('OriginalPass94'), 'role' => 'USER', 'status' => 'SUSPENDED'],
        ]);
    }

    private function requestToken(string $email = 'user@test.local'): string
    {
        $this->postJson('/api/auth/forgot-password', ['email' => $email])->assertOk();
        $mail = Mail::sent(PasswordRecoveryMail::class)->last();
        $this->assertNotNull($mail->resetUrl);

        return substr($mail->resetUrl, strpos($mail->resetUrl, '#token=') + 7);
    }

    private function resetBody(string $token): array
    {
        return ['token' => $token, 'password' => 'NewSecurePass94', 'confirmPassword' => 'NewSecurePass94'];
    }

    public function test_requests_do_not_reveal_accounts_and_only_mail_eligible_users(): void
    {
        $known = $this->postJson('/api/auth/forgot-password', ['email' => 'USER@test.local'])->assertOk();
        $unknown = $this->postJson('/api/auth/forgot-password', ['email' => 'missing@test.local'])->assertOk();
        $suspended = $this->postJson('/api/auth/forgot-password', ['email' => 'suspended@test.local'])->assertOk();
        $this->assertSame($known->json(), $unknown->json());
        $this->assertSame($known->json(), $suspended->json());
        Mail::assertSentCount(1);
        $mail = Mail::sent(PasswordRecoveryMail::class)->first();
        $this->assertStringStartsWith('https://qfs.test/reset-password#token=', $mail->resetUrl);
        $token = substr($mail->resetUrl, strpos($mail->resetUrl, '#token=') + 7);
        $this->assertSame(hash('sha256', $token), DB::table('PasswordRecoveryToken')->value('tokenHash'));
        $this->assertStringNotContainsString($token, $known->getContent());
        $this->assertStringContainsString('30 minutes', $mail->render());
        $this->assertSame(1, DB::table('PasswordRecoveryToken')->count());
    }

    public function test_reset_changes_password_revokes_sessions_and_is_single_use_for_admins_too(): void
    {
        $oldSession = SessionAuth::issue('admin');
        SessionAuth::issue('admin');
        SessionAuth::issue('user');
        $token = $this->requestToken('admin@test.local');
        $this->postJson('/api/auth/reset-password', $this->resetBody($token))->assertOk();
        $this->assertTrue(Hash::check('NewSecurePass94', DB::table('User')->where('id', 'admin')->value('passwordHash')));
        $this->assertSame(0, DB::table('Session')->where('userId', 'admin')->count());
        $this->assertSame(1, DB::table('Session')->where('userId', 'user')->count());
        $this->assertSame(0, DB::table('PasswordRecoveryToken')->count());
        $this->withUnencryptedCookie('qfs_session', $oldSession)->getJson('/api/auth/me')->assertStatus(401);
        $this->postJson('/api/auth/reset-password', $this->resetBody($token))->assertStatus(400);
        $this->postJson('/api/auth/login', ['email' => 'admin@test.local', 'password' => 'OriginalPass94'])->assertStatus(401);
        $this->postJson('/api/auth/login', ['email' => 'admin@test.local', 'password' => 'NewSecurePass94'])->assertOk()->assertJsonPath('data.user.role', 'ADMIN');
        $this->assertSame(1, DB::table('Notification')->count());
        Mail::assertSentCount(2);
    }

    public function test_expired_and_replaced_links_cannot_change_passwords(): void
    {
        $first = $this->requestToken();
        $this->travel(61)->seconds();
        $second = $this->requestToken();
        $this->assertNotSame($first, $second);
        $this->postJson('/api/auth/reset-password', $this->resetBody($first))->assertStatus(400);
        $this->travel(30)->minutes();
        $this->postJson('/api/auth/reset-password', $this->resetBody($second))->assertStatus(400);
        $this->assertTrue(Hash::check('OriginalPass94', DB::table('User')->where('id', 'user')->value('passwordHash')));
    }

    public function test_password_validation_does_not_consume_a_valid_link_and_suspended_accounts_cannot_reset(): void
    {
        $token = $this->requestToken();
        foreach ([['password' => 'weak', 'confirmPassword' => 'weak'], ['confirmPassword' => 'Mismatch94'],
            ['password' => str_repeat('é', 36).'A1', 'confirmPassword' => str_repeat('é', 36).'A1']] as $invalid) {
            $this->postJson('/api/auth/reset-password', [...$this->resetBody($token), ...$invalid])->assertStatus(400);
        }
        $this->assertSame(1, DB::table('PasswordRecoveryToken')->count());
        DB::table('User')->where('id', 'user')->update(['status' => 'SUSPENDED']);
        $this->postJson('/api/auth/reset-password', $this->resetBody($token))->assertStatus(400);
        $this->assertSame(0, DB::table('Notification')->count());
    }

    public function test_recovery_is_rate_limited_without_exposing_tokens(): void
    {
        $this->requestToken();
        $this->postJson('/api/auth/forgot-password', ['email' => 'user@test.local'])->assertStatus(429);
        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/auth/forgot-password', ['email' => 'missing'.$i.'@test.local'])->assertOk();
        }
        $this->postJson('/api/auth/forgot-password', ['email' => 'another@test.local'])->assertStatus(429);
        Mail::assertSentCount(1);
    }

    public function test_log_only_delivery_is_unavailable_outside_tests_and_leaks_no_link(): void
    {
        app()->instance('env', 'local');
        config()->set('mail.default', 'log');
        $this->postJson('/api/auth/forgot-password', ['email' => 'user@test.local'])->assertStatus(503);
        $this->postJson('/api/auth/forgot-password', ['email' => 'missing@test.local'])->assertStatus(503);
        $this->assertSame(0, DB::table('PasswordRecoveryToken')->count());
        Mail::assertNothingSent();
    }

    public function test_mail_failure_keeps_generic_response_and_removes_the_undelivered_token(): void
    {
        Mail::shouldReceive('to')->once()->andReturnSelf();
        Mail::shouldReceive('send')->once()->andThrow(new \RuntimeException('Sensitive delivery failure'));
        Log::shouldReceive('error')->once()->with('Password recovery email delivery failed.', ['exception' => \RuntimeException::class]);
        $this->postJson('/api/auth/forgot-password', ['email' => 'user@test.local'])->assertOk();
        $this->assertSame(0, DB::table('PasswordRecoveryToken')->count());
    }
}
