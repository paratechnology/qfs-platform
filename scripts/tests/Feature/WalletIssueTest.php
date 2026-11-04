<?php

namespace Tests\Feature;

use App\Support\SessionAuth;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class WalletIssueTest extends TestCase
{
    private string $userToken;

    private string $adminToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withCredentials();
        config()->set('qfs.session_secret', str_repeat('x', 64));
        RateLimiter::clear('wallet:issue:user-1');
        Schema::create('User', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('email');
            $t->string('name');
            $t->string('role')->default('USER');
            $t->string('status')->default('ACTIVE');
        });
        Schema::create('Session', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('tokenHash');
            $t->timestamp('expiresAt');
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('WalletIssue', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('subject');
            $t->text('message');
            $t->string('status')->default('OPEN');
            $t->string('userAgent')->nullable();
            $t->string('pageUrl')->nullable();
            $t->string('resolvedById')->nullable();
            $t->timestamp('resolvedAt')->nullable();
            $t->timestamp('createdAt')->useCurrent();
            $t->timestamp('updatedAt')->useCurrent();
        });
        Schema::create('AuditLog', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('actorId');
            $t->string('actorRole');
            $t->string('action');
            $t->string('targetType');
            $t->string('targetId')->nullable();
            $t->text('meta')->nullable();
        });
        DB::table('User')->insert([
            ['id' => 'user-1', 'email' => 'wallet@test.local', 'name' => 'Wallet User', 'role' => 'USER'],
            ['id' => 'admin-1', 'email' => 'admin@test.local', 'name' => 'Admin', 'role' => 'ADMIN'],
        ]);
        $this->userToken = SessionAuth::issue('user-1');
        $this->adminToken = SessionAuth::issue('admin-1');
    }

    public function test_user_can_report_a_wallet_issue(): void
    {
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->postJson('/api/wallet/issues', [
                'subject' => 'WALLET_NOT_DETECTED',
                'message' => 'No wallet extension appears in this browser.',
                'pageUrl' => 'https://qfs.test/user/user/connect',
            ])
            ->assertOk()
            ->assertJsonPath('data.status', 'OPEN');

        $this->assertSame(1, DB::table('WalletIssue')->count());
        $this->assertSame('WALLET_NOT_DETECTED', DB::table('WalletIssue')->value('subject'));
    }

    public function test_report_requires_a_real_message(): void
    {
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->postJson('/api/wallet/issues', ['subject' => 'OTHER', 'message' => 'short'])
            ->assertStatus(400);
    }

    public function test_regular_users_cannot_list_or_resolve_wallet_issues(): void
    {
        $id = $this->createIssue();
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->getJson('/api/admin/wallet-issues')
            ->assertStatus(403);
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->patchJson('/api/admin/wallet-issues/'.$id, ['action' => 'RESOLVE'])
            ->assertStatus(403);
    }

    public function test_admin_can_list_resolve_and_delete_wallet_issues(): void
    {
        $id = $this->createIssue();
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->getJson('/api/admin/wallet-issues')
            ->assertOk()
            ->assertJsonPath('data.total', 1)
            ->assertJsonPath('data.items.0.userEmail', 'wallet@test.local');

        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/wallet-issues/'.$id, ['action' => 'RESOLVE'])
            ->assertOk()
            ->assertJsonPath('data.status', 'RESOLVED');
        $this->assertSame('RESOLVED', DB::table('WalletIssue')->where('id', $id)->value('status'));

        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->deleteJson('/api/admin/wallet-issues/'.$id)
            ->assertOk();
        $this->assertSame(0, DB::table('WalletIssue')->count());
    }

    private function createIssue(): string
    {
        $id = 'issue-1';
        DB::table('WalletIssue')->insert([
            'id' => $id, 'userId' => 'user-1', 'subject' => 'CONNECT_FAILED',
            'message' => 'Connect wallet stays disabled.', 'status' => 'OPEN',
        ]);

        return $id;
    }
}
