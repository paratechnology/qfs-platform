<?php

namespace Tests\Feature;

use App\Jobs\SendAccountEmail;
use App\Mail\AccountUpdateMail;
use App\Support\AccountEmail;
use App\Support\SessionAuth;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
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
        config()->set('qfs.account_emails', false);
        RateLimiter::clear('wallet:issue:user-1');
        Schema::create('User', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('email');
            $t->string('name');
            $t->string('role')->default('USER');
            $t->string('status')->default('ACTIVE');
            $t->string('locale')->default('en');
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
        (require database_path('migrations/2026_11_05_121528_add_manual_review_fields_to_wallet_issue.php'))->up();
        Schema::create('Notification', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('title');
            $t->text('body')->nullable();
            $t->text('messageParams')->nullable();
            $t->timestamp('createdAt')->useCurrent();
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

    private function manualReview(array $extra = []): array
    {
        return array_replace(['subject' => 'MANUAL_REVIEW', 'walletProvider' => 'Ledger', 'assetKey' => 'ETH',
            'publicAddress' => '0x'.str_repeat('1', 40)], $extra);
    }

    public function test_manual_reviews_validate_public_addresses_and_are_private_to_the_owner(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->postJson('/api/wallet/issues', $this->manualReview())->assertUnauthorized();
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->postJson('/api/wallet/issues', $this->manualReview(['publicAddress' => 'not an address']))->assertStatus(400);
        foreach (['seedPhrase', 'privateKey', 'verificationKey', 'recoveryPhrase', 'mnemonic'] as $field) {
            $this->postJson('/api/wallet/issues', $this->manualReview([$field => 'must never be stored']))->assertStatus(400);
        }
        $this->assertSame(0, DB::table('WalletIssue')->count());
        $id = $this->postJson('/api/wallet/issues', $this->manualReview())->assertOk()->assertJsonPath('data.status', 'UNDER_REVIEW')->json('data.id');
        $this->getJson('/api/wallet/issues')->assertOk()->assertJsonPath('data.items.0.id', $id)->assertJsonMissingPath('data.items.0.userAgent');
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)->getJson('/api/wallet/issues')->assertOk()->assertJsonCount(0, 'data.items');
        $this->getJson('/api/admin/wallet-issues?status=PENDING')->assertOk()->assertJsonPath('data.items.0.walletProvider', 'Ledger');
    }

    public function test_manual_approval_is_idempotent_notifies_and_queues_confirmation_email(): void
    {
        config()->set('qfs.account_emails', true);
        config()->set('mail.default', 'array');
        config()->set('queue.default', 'database');
        config()->set('qfs.public_url', 'https://q-arculuspro.live');
        Queue::fake();
        Mail::fake();
        $id = $this->withUnencryptedCookie('qfs_session', $this->userToken)->postJson('/api/wallet/issues', $this->manualReview())->assertOk()->json('data.id');
        $this->patchJson('/api/admin/wallet-issues/'.$id, ['action' => 'APPROVE'])->assertForbidden();
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)->patchJson('/api/admin/wallet-issues/'.$id, ['action' => 'RESOLVE'])->assertStatus(400);
        $this->patchJson('/api/admin/wallet-issues/'.$id, ['action' => 'APPROVE', 'note' => 'Public address reviewed'])->assertOk()->assertJsonPath('data.status', 'APPROVED');
        $this->patchJson('/api/admin/wallet-issues/'.$id, ['action' => 'APPROVE'])->assertOk();
        $this->patchJson('/api/admin/wallet-issues/'.$id, ['action' => 'REJECT', 'note' => 'Conflict'])->assertStatus(409);
        $this->assertSame(1, DB::table('Notification')->count());
        $this->assertSame(1, DB::table('AuditLog')->where('action', 'WALLET_ISSUE.APPROVE')->count());
        Queue::assertPushed(SendAccountEmail::class, 1);
        (new SendAccountEmail(DB::table('Notification')->value('id')))->handle();
        Mail::assertSent(AccountUpdateMail::class, fn ($mail) => $mail->hasTo('wallet@test.local') && $mail->actionUrl === AccountEmail::actionUrl('Wallet review approved'));
        $this->assertSame('https://q-arculuspro.live/user/user/connect', AccountEmail::actionUrl('Wallet review approved'));
    }

    public function test_manual_decline_requires_a_note_and_old_support_reports_keep_resolve_action(): void
    {
        $id = $this->withUnencryptedCookie('qfs_session', $this->userToken)->postJson('/api/wallet/issues', $this->manualReview())->assertOk()->json('data.id');
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)->patchJson('/api/admin/wallet-issues/'.$id, ['action' => 'REJECT'])->assertStatus(400);
        $this->patchJson('/api/admin/wallet-issues/'.$id, ['action' => 'REJECT', 'note' => 'Select the correct network'])->assertOk();
        $this->withUnencryptedCookie('qfs_session', $this->userToken)->getJson('/api/wallet/issues')->assertJsonPath('data.items.0.reviewNote', 'Select the correct network');
        $generic = $this->createIssue();
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)->patchJson('/api/admin/wallet-issues/'.$generic, ['action' => 'APPROVE'])->assertStatus(400);
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
