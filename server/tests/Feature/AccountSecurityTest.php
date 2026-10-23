<?php

namespace Tests\Feature;

use App\Support\SessionAuth;
use App\Support\TwoFactor;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AccountSecurityTest extends TestCase
{
    private string $token;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withCredentials();
        config()->set('qfs.session_secret', str_repeat('x', 64));
        Schema::create('User', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('email')->unique();
            $table->string('name');
            $table->string('passwordHash');
            $table->string('role')->default('USER');
            $table->string('status')->default('ACTIVE');
            $table->string('phone')->nullable();
            $table->string('country')->default('Nigeria');
            $table->string('avatarUrl')->default('');
            $table->string('referralCode')->default('');
            $table->integer('kycLevel')->default(1);
            $table->timestamp('memberSince')->useCurrent();
            $table->timestamp('lastLoginAt')->nullable();
            $table->timestamp('updatedAt')->useCurrent();
        });
        Schema::create('Session', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('tokenHash');
            $table->timestamp('expiresAt');
            $table->timestamp('createdAt')->useCurrent();
        });
        foreach (['Notification', 'AuditLog'] as $name) {
            Schema::create($name, function (Blueprint $table) use ($name) {
                $table->string('id')->primary();
                if ($name === 'Notification') {
                    $table->string('userId');
                    $table->string('title');
                    $table->text('body')->nullable();
                } else {
                    $table->string('actorId');
                    $table->string('actorRole');
                    $table->string('action');
                    $table->string('targetType');
                    $table->string('targetId')->nullable();
                    $table->text('meta')->nullable();
                }
            });
        }
        (require database_path('migrations/2026_10_11_060521_create_password_recovery_tokens.php'))->up();
        (require database_path('migrations/2026_10_16_220933_add_account_security.php'))->up();
        foreach (['admin', 'other'] as $id) {
            DB::table('User')->insert(['id' => $id, 'email' => $id.'@test.local', 'name' => ucfirst($id), 'role' => $id === 'admin' ? 'ADMIN' : 'USER', 'passwordHash' => Hash::make('OriginalPass94')]);
        }
        $this->token = SessionAuth::issue('admin');
        $this->withUnencryptedCookie('qfs_session', $this->token);
    }

    private function enable(): array
    {
        $setup = $this->postJson('/api/account/two-factor/setup', ['currentPassword' => 'OriginalPass94'])->assertOk()->json('data');
        $this->assertNotSame($setup['secret'], DB::table('AccountSecurity')->value('pendingSecret'));
        $this->assertStringContainsString('otpauth://totp/', $setup['uri']);
        $result = $this->postJson('/api/account/two-factor', ['action' => 'ENABLE', 'currentPassword' => 'OriginalPass94', 'code' => TwoFactor::code($setup['secret'], intdiv(now()->timestamp, 30))])->assertOk()->json('data');

        return [$setup['secret'], $result['recoveryCodes']];
    }

    public function test_totp_matches_published_rfc_vectors_including_leading_zeroes(): void
    {
        $secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
        foreach ([59 => '287082', 1111111109 => '081804', 1111111111 => '050471', 1234567890 => '005924', 2000000000 => '279037', 20000000000 => '353130'] as $time => $code) {
            $this->assertSame($code, TwoFactor::code($secret, intdiv($time, 30)));
        }
    }

    public function test_profile_is_owner_scoped_and_cannot_change_email_role_or_verification(): void
    {
        $this->patchJson('/api/account/profile', ['name' => '  New Name  ', 'country' => 'France', 'phone' => '+33 123456789', 'role' => 'USER', 'email' => 'hijack@test.local', 'kycLevel' => 0])
            ->assertOk()->assertJsonPath('data.name', 'New Name')->assertJsonPath('data.email', 'admin@test.local')->assertJsonPath('data.role', 'ADMIN')->assertJsonPath('data.kycLevel', 1);
        $this->assertSame('Other', DB::table('User')->where('id', 'other')->value('name'));
        $this->patchJson('/api/account/profile', ['name' => ' ', 'country' => 'France'])->assertStatus(400);
    }

    public function test_session_expiry_uses_the_application_clock(): void
    {
        $this->travelTo(now()->setDate(2026, 1, 1)->startOfDay());
        $token = SessionAuth::issue('admin');
        $this->withUnencryptedCookie('qfs_session', $token)->getJson('/api/auth/me')->assertOk();
        $this->travel(8)->days();
        $this->getJson('/api/auth/me')->assertUnauthorized();
        $this->assertDatabaseMissing('Session', ['tokenHash' => SessionAuth::tokenHash($token)]);
    }

    public function test_sessions_are_private_and_revocation_requires_password_and_preserves_current(): void
    {
        $second = SessionAuth::issue('admin');
        $other = SessionAuth::issue('other');
        $sessions = $this->getJson('/api/account/security')->assertOk()->json('data.sessions');
        $this->assertCount(2, $sessions);
        $this->assertCount(1, array_filter($sessions, fn ($s) => $s['current']));
        $this->assertStringNotContainsString('tokenHash', json_encode($sessions));
        $this->deleteJson('/api/account/sessions/others', ['currentPassword' => 'wrong'])->assertStatus(400);
        $otherId = DB::table('Session')->where('userId', 'other')->value('id');
        $this->deleteJson('/api/account/sessions/'.$otherId, ['currentPassword' => 'OriginalPass94'])->assertOk()->assertJsonPath('data.revoked', 0);
        $current = array_values(array_filter($sessions, fn ($s) => $s['current']))[0]['id'];
        $this->deleteJson('/api/account/sessions/'.$current, ['currentPassword' => 'OriginalPass94'])->assertStatus(400);
        $this->deleteJson('/api/account/sessions/others', ['currentPassword' => 'OriginalPass94'])->assertOk()->assertJsonPath('data.revoked', 1);
        $this->withUnencryptedCookie('qfs_session', $second)->getJson('/api/auth/me')->assertUnauthorized();
        $this->withUnencryptedCookie('qfs_session', $other)->getJson('/api/auth/me')->assertOk();
    }

    public function test_password_change_revokes_other_sessions_and_recovery_tokens(): void
    {
        SessionAuth::issue('admin');
        SessionAuth::issue('other');
        DB::table('PasswordRecoveryToken')->insert(['userId' => 'admin', 'tokenHash' => 'old', 'expiresAt' => now()->addMinutes(30)]);
        $body = ['currentPassword' => 'OriginalPass94', 'password' => 'UpdatedPass94', 'confirmPassword' => 'UpdatedPass94'];
        $this->postJson('/api/account/password', [...$body, 'currentPassword' => 'wrong'])->assertStatus(400);
        $this->postJson('/api/account/password', $body)->assertOk();
        $this->assertTrue(Hash::check('UpdatedPass94', DB::table('User')->where('id', 'admin')->value('passwordHash')));
        $this->assertSame(1, DB::table('Session')->where('userId', 'admin')->count());
        $this->assertSame(1, DB::table('Session')->where('userId', 'other')->count());
        $this->assertSame(0, DB::table('PasswordRecoveryToken')->count());
        $this->getJson('/api/auth/me')->assertOk();
    }

    public function test_enrollment_is_session_bound_and_expiring_and_removes_old_sessions(): void
    {
        $setup = $this->postJson('/api/account/two-factor/setup', ['currentPassword' => 'OriginalPass94'])->assertOk()->json('data');
        $otherSession = SessionAuth::issue('admin');
        $body = ['action' => 'ENABLE', 'currentPassword' => 'OriginalPass94', 'code' => TwoFactor::code($setup['secret'], intdiv(now()->timestamp, 30))];
        $this->withUnencryptedCookie('qfs_session', $otherSession)->postJson('/api/account/two-factor', $body)->assertStatus(409);
        $this->withUnencryptedCookie('qfs_session', $this->token)->postJson('/api/account/two-factor', [...$body, 'code' => 'wrong'])->assertStatus(400);
        $this->travel(11)->minutes();
        $this->postJson('/api/account/two-factor', $body)->assertStatus(409);
        [, $codes] = $this->enable();
        $this->assertCount(10, $codes);
        $this->assertSame(1, DB::table('Session')->where('userId', 'admin')->count());
        $this->assertStringNotContainsString($codes[0], DB::table('AccountSecurity')->value('recoveryHashes'));
    }

    public function test_factor_login_does_not_issue_session_until_proven_and_prevents_replay(): void
    {
        $this->freezeTime();
        [$secret, $codes] = $this->enable();
        $this->postJson('/api/auth/logout')->assertOk();
        $login = $this->postJson('/api/auth/login', ['email' => 'admin@test.local', 'password' => 'OriginalPass94'])->assertOk()->assertJsonPath('data.twoFactorRequired', true);
        $this->assertSame(0, DB::table('Session')->count());
        $this->assertStringNotContainsString('qfs_session=', implode(';', $login->headers->all('set-cookie')));
        $challenge = $login->json('data.challenge');
        $this->postJson('/api/auth/two-factor', ['challenge' => $challenge, 'code' => TwoFactor::code($secret, intdiv(now()->timestamp, 30))])->assertStatus(400);
        $this->travel(31)->seconds();
        $this->postJson('/api/auth/two-factor', ['challenge' => $challenge, 'code' => TwoFactor::code($secret, intdiv(now()->timestamp, 30))])->assertOk()->assertJsonPath('data.user.role', 'ADMIN');
        $this->postJson('/api/auth/two-factor', ['challenge' => $challenge, 'code' => $codes[0]])->assertStatus(400);
        $this->assertSame(1, DB::table('Session')->count());
        $this->assertNotNull(DB::table('Session')->value('ipAddress'));
    }

    public function test_login_challenge_has_five_attempts_and_recovery_codes_are_single_use(): void
    {
        [, $codes] = $this->enable();
        $this->postJson('/api/auth/logout');
        $body = ['email' => 'admin@test.local', 'password' => 'OriginalPass94'];
        $challenge = $this->postJson('/api/auth/login', $body)->json('data.challenge');
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/auth/two-factor', ['challenge' => $challenge, 'code' => 'wrong'])->assertStatus(400);
        }
        $this->postJson('/api/auth/two-factor', ['challenge' => $challenge, 'code' => $codes[0]])->assertStatus(400);
        $challenge = $this->postJson('/api/auth/login', $body)->json('data.challenge');
        $this->postJson('/api/auth/two-factor', ['challenge' => $challenge, 'code' => $codes[0]])->assertOk();
        $challenge = $this->postJson('/api/auth/login', $body)->json('data.challenge');
        $this->postJson('/api/auth/two-factor', ['challenge' => $challenge, 'code' => $codes[0]])->assertStatus(400);
        $this->assertCount(9, json_decode(DB::table('AccountSecurity')->value('recoveryHashes'), true));
    }

    public function test_challenge_expires_and_password_change_invalidates_old_challenges(): void
    {
        [, $codes] = $this->enable();
        $body = ['email' => 'admin@test.local', 'password' => 'OriginalPass94'];
        $challenge = $this->postJson('/api/auth/login', $body)->json('data.challenge');
        $this->travel(6)->minutes();
        $this->postJson('/api/auth/two-factor', ['challenge' => $challenge, 'code' => $codes[0]])->assertStatus(400);
        $challenge = $this->postJson('/api/auth/login', $body)->json('data.challenge');
        DB::table('User')->where('id', 'admin')->update(['passwordHash' => Hash::make('ReplacedPass94')]);
        $this->postJson('/api/auth/two-factor', ['challenge' => $challenge, 'code' => $codes[0]])->assertStatus(400);
    }

    public function test_security_changes_require_second_factor_and_replacement_codes_invalidate_old_codes(): void
    {
        [, $codes] = $this->enable();
        $this->postJson('/api/account/two-factor', ['action' => 'DISABLE', 'currentPassword' => 'OriginalPass94', 'code' => 'wrong'])->assertStatus(400);
        $new = $this->postJson('/api/account/two-factor', ['action' => 'RECOVERY_CODES', 'currentPassword' => 'OriginalPass94', 'code' => $codes[0]])->assertOk()->json('data.recoveryCodes');
        $this->postJson('/api/account/two-factor', ['action' => 'DISABLE', 'currentPassword' => 'OriginalPass94', 'code' => $codes[1]])->assertStatus(400);
        $this->travel(61)->seconds();
        $this->postJson('/api/account/two-factor', ['action' => 'DISABLE', 'currentPassword' => 'OriginalPass94', 'code' => $new[0]])->assertOk();
        $this->assertNull(DB::table('AccountSecurity')->value('secret'));
        $this->assertNull(DB::table('AccountSecurity')->value('enabledAt'));
        $this->assertSame(3, DB::table('AuditLog')->count());
    }

    public function test_password_recovery_preserves_second_factor_and_invalidates_existing_sessions(): void
    {
        Mail::fake();
        [, $codes] = $this->enable();
        $token = bin2hex(random_bytes(32));
        DB::table('PasswordRecoveryToken')->insert(['userId' => 'admin', 'tokenHash' => hash('sha256', $token), 'expiresAt' => now()->addMinutes(30)]);
        $this->postJson('/api/auth/reset-password', ['token' => $token, 'password' => 'RecoveredPass94', 'confirmPassword' => 'RecoveredPass94'])->assertOk();
        $this->getJson('/api/auth/me')->assertUnauthorized();
        $challenge = $this->postJson('/api/auth/login', ['email' => 'admin@test.local', 'password' => 'RecoveredPass94'])->assertOk()->assertJsonPath('data.twoFactorRequired', true)->json('data.challenge');
        $this->assertSame(0, DB::table('Session')->count());
        $this->postJson('/api/auth/two-factor', ['challenge' => $challenge, 'code' => $codes[0]])->assertOk();
    }

    private function profileChange(array $overrides = []): array
    {
        return array_replace(['action' => 'UPDATE_PROFILE', 'name' => 'Updated Member', 'email' => 'other@test.local',
            'phone' => '+234 8000000000', 'country' => 'Ghana', 'reason' => 'Requested by the account owner',
            'currentPassword' => 'OriginalPass94'], $overrides);
    }

    public function test_admin_profile_changes_are_limited_audited_and_do_not_change_financial_or_verified_fields(): void
    {
        $token = SessionAuth::issue('other');
        $this->patchJson('/api/admin/users/other', $this->profileChange(['role' => 'ADMIN', 'kycLevel' => 9, 'balanceCents' => 1000000]))
            ->assertOk()->assertJsonPath('data.changed', true)->assertJsonPath('data.sessionsRevoked', false);
        $user = DB::table('User')->where('id', 'other')->first();
        $this->assertSame('Updated Member', $user->name);
        $this->assertSame('Ghana', $user->country);
        $this->assertSame('USER', $user->role);
        $this->assertSame(1, $user->kycLevel);
        $this->assertSame(1, DB::table('Session')->where('tokenHash', SessionAuth::tokenHash($token))->count());
        $audit = DB::table('AuditLog')->where('action', 'USER.UPDATE_PROFILE')->first();
        $meta = json_decode($audit->meta, true);
        $this->assertSame('admin', $audit->actorId);
        $this->assertSame('Requested by the account owner', $meta['reason']);
        $this->assertSame(['name', 'phone', 'country'], $meta['fields']);
        $this->assertStringNotContainsString('OriginalPass94', $audit->meta);
        $this->assertSame(1, DB::table('Notification')->where('userId', 'other')->count());
    }

    public function test_admin_email_change_revokes_sessions_recovery_links_and_pending_logins(): void
    {
        SessionAuth::issue('other');
        DB::table('PasswordRecoveryToken')->insert(['userId' => 'other', 'tokenHash' => str_repeat('a', 64), 'expiresAt' => now()->addMinutes(20)]);
        DB::table('LoginChallenge')->insert(['userId' => 'other', 'tokenHash' => str_repeat('b', 64), 'passwordFingerprint' => str_repeat('c', 64), 'expiresAt' => now()->addMinutes(5)]);
        $this->patchJson('/api/admin/users/other', $this->profileChange(['email' => 'NEW-EMAIL@example.test']))
            ->assertOk()->assertJsonPath('data.sessionsRevoked', true);
        $this->assertSame('new-email@example.test', DB::table('User')->where('id', 'other')->value('email'));
        foreach (['Session', 'PasswordRecoveryToken', 'LoginChallenge'] as $table) {
            $this->assertSame(0, DB::table($table)->where('userId', 'other')->count());
        }
        $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('data.id', 'admin');
    }

    public function test_admin_profile_changes_require_password_and_an_enabled_second_factor(): void
    {
        $this->patchJson('/api/admin/users/other', $this->profileChange(['currentPassword' => 'IncorrectPass94']))
            ->assertStatus(400)->assertJsonPath('error.code', 'INVALID_PASSWORD');
        [, $codes] = $this->enable();
        $this->patchJson('/api/admin/users/other', $this->profileChange())->assertStatus(400)->assertJsonPath('error.code', 'INVALID_CODE');
        $this->assertSame('Other', DB::table('User')->where('id', 'other')->value('name'));
        $this->patchJson('/api/admin/users/other', $this->profileChange(['code' => $codes[0]]))->assertOk();
        $this->patchJson('/api/admin/users/other', $this->profileChange(['code' => $codes[0]]))->assertStatus(400)->assertJsonPath('error.code', 'INVALID_CODE');
    }

    public function test_admin_profile_changes_reject_duplicate_emails_missing_reason_and_self_edits(): void
    {
        $this->patchJson('/api/admin/users/other', $this->profileChange(['email' => 'admin@test.local']))->assertStatus(409);
        $this->patchJson('/api/admin/users/other', $this->profileChange(['reason' => '']))->assertStatus(400);
        $this->patchJson('/api/admin/users/admin', $this->profileChange())->assertStatus(400);
        $this->assertSame('Other', DB::table('User')->where('id', 'other')->value('name'));
        $this->assertSame(0, DB::table('AuditLog')->count());
        $this->withUnencryptedCookie('qfs_session', SessionAuth::issue('other'))
            ->patchJson('/api/admin/users/admin', $this->profileChange())->assertForbidden();
        $this->withUnencryptedCookie('qfs_session', 'invalid')->patchJson('/api/admin/users/other', $this->profileChange())->assertUnauthorized();
    }
}
