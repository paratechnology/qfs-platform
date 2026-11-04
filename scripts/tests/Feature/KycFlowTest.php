<?php

namespace Tests\Feature;

use App\Support\SessionAuth;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class KycFlowTest extends TestCase
{
    private string $userToken;

    private string $otherToken;

    private string $adminToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withCredentials();
        config()->set('qfs.session_secret', str_repeat('x', 64));
        Storage::fake('local');
        Schema::create('User', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('email');
            $t->string('name');
            $t->string('role')->default('USER');
            $t->string('status')->default('ACTIVE');
            $t->integer('kycLevel')->default(0);
            $t->string('avatarUrl')->default('');
            $t->string('country')->default('');
            $t->string('referralCode')->default('');
            $t->timestamp('memberSince')->useCurrent();
        });
        Schema::create('Session', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('tokenHash');
            $t->timestamp('expiresAt');
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('InvestmentPlan', fn (Blueprint $t) => $t->string('id')->primary());
        Schema::create('Investment', fn (Blueprint $t) => $t->string('id')->primary());
        Schema::create('Notification', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('title');
            $t->text('body')->nullable();
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
        (require database_path('migrations/2026_10_10_080537_add_private_kyc_and_investment_materials.php'))->up();
        (require database_path('migrations/2026_10_16_220936_preserve_kyc_review_history.php'))->up();
        DB::table('User')->insert([
            ['id' => 'user', 'email' => 'user@test.local', 'name' => 'User', 'role' => 'USER'],
            ['id' => 'other', 'email' => 'other@test.local', 'name' => 'Other', 'role' => 'USER'],
            ['id' => 'admin', 'email' => 'admin@test.local', 'name' => 'Admin', 'role' => 'ADMIN'],
        ]);
        $this->userToken = SessionAuth::issue('user');
        $this->otherToken = SessionAuth::issue('other');
        $this->adminToken = SessionAuth::issue('admin');
    }

    private function details(array $changes = []): array
    {
        return ['legalName' => 'Example Person', 'dateOfBirth' => '1992-05-10', 'country' => 'Nigeria',
            'address' => '10 Example Street, Lagos', 'documentType' => 'PASSPORT', ...$changes];
    }

    private function image(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('face.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF7cAAAAASUVORK5CYII='));
    }

    private function ready(array $changes = []): array
    {
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->postJson('/api/kyc', $this->details($changes))->assertOk();
        foreach (['IDENTITY_FRONT', 'PORTRAIT'] as $kind) {
            $this->post('/api/kyc/files', ['kind' => $kind, 'file' => $this->image()])->assertOk();
        }

        return $this->getJson('/api/kyc')->assertOk()->json('data');
    }

    public function test_private_uploads_and_details_are_encrypted_and_owner_scoped(): void
    {
        $this->getJson('/api/kyc')->assertUnauthorized();
        $record = $this->ready();
        $encrypted = DB::table('KycSubmission')->value('details');
        $this->assertStringNotContainsString('Example Person', $encrypted);
        $this->assertSame('Example Person', json_decode(Crypt::decryptString($encrypted), true)['legalName']);
        $file = DB::table('KycFile')->first();
        $stored = Storage::disk('local')->get($file->storagePath);
        $this->assertStringStartsWith('kyc/', $file->storagePath);
        $this->assertStringNotContainsString('PNG', $stored);
        $url = '/api/kyc/files/'.$file->id;
        $this->get($url)->assertOk()->assertHeader('Cache-Control', 'no-store, private')->assertHeader('Content-Type', 'image/png');
        $this->withUnencryptedCookie('qfs_session', $this->otherToken)->get($url)->assertNotFound();
        $this->getJson('/api/kyc')->assertJsonPath('data.status', 'NOT_STARTED');
        $this->getJson('/api/admin/kyc')->assertForbidden();
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)->get($url)->assertOk();
        $this->assertSame(1, DB::table('AuditLog')->where('action', 'KYC.FILE_VIEW')->count());
        $this->assertSame(2, count($record['files']));
    }

    public function test_submission_requires_documents_and_consent_and_pending_is_locked(): void
    {
        $this->withUnencryptedCookie('qfs_session', $this->userToken)->postJson('/api/kyc', $this->details())->assertOk();
        $this->postJson('/api/kyc/submit', ['consent' => true])->assertStatus(400);
        $this->ready(['documentType' => 'NATIONAL_ID']);
        $this->postJson('/api/kyc/submit', ['consent' => true])->assertStatus(400);
        $this->post('/api/kyc/files', ['kind' => 'IDENTITY_BACK', 'file' => $this->image()])->assertOk();
        $this->postJson('/api/kyc/submit', [])->assertStatus(400);
        $this->postJson('/api/kyc/submit', ['consent' => true])->assertOk()->assertJsonPath('data.status', 'PENDING');
        $this->postJson('/api/kyc', $this->details())->assertStatus(409);
        $this->post('/api/kyc/files', ['kind' => 'PORTRAIT', 'file' => $this->image()])->assertStatus(409);
        $this->assertCount(3, Storage::disk('local')->allFiles('kyc'));
        $this->postJson('/api/kyc/submit', ['consent' => true])->assertStatus(409);
        $this->assertSame(0, DB::table('User')->where('id', 'user')->value('kycLevel'));
    }

    public function test_admin_changes_resubmission_approval_and_stale_review_protection(): void
    {
        $this->ready();
        $pending = $this->postJson('/api/kyc/submit', ['consent' => true])->assertOk()->json('data');
        $url = '/api/admin/kyc/'.$pending['id'];
        $this->patchJson($url, ['action' => 'APPROVE', 'version' => $pending['version']])->assertForbidden();
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson($url, ['action' => 'APPROVE', 'version' => $pending['version'] - 1])->assertStatus(409);
        $this->patchJson($url, ['action' => 'REQUEST_CHANGES', 'version' => $pending['version']])->assertStatus(400);
        $this->patchJson($url, ['action' => 'REQUEST_CHANGES', 'version' => $pending['version'], 'note' => 'Upload a clearer identity document.'])
            ->assertOk()->assertJsonPath('data.status', 'NEEDS_CHANGES');
        $this->assertStringNotContainsString('Upload a clearer', DB::table('KycSubmission')->value('reviewNote'));
        $this->withUnencryptedCookie('qfs_session', $this->userToken)->getJson('/api/kyc')
            ->assertJsonPath('data.reviewNote', 'Upload a clearer identity document.');
        $this->postJson('/api/kyc', $this->details())->assertOk();
        $new = $this->postJson('/api/kyc/submit', ['consent' => true])->assertOk()->json('data');
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson($url, ['action' => 'APPROVE', 'version' => $new['version']])->assertOk()->assertJsonPath('data.status', 'APPROVED');
        $this->assertSame(1, DB::table('User')->where('id', 'user')->value('kycLevel'));
        $this->patchJson($url, ['action' => 'APPROVE', 'version' => $new['version']])->assertStatus(409);
        $this->assertSame(1, DB::table('AuditLog')->where('action', 'KYC.APPROVE')->count());
    }

    public function test_unsupported_and_oversized_files_are_rejected_without_retaining_them(): void
    {
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->post('/api/kyc/files', ['kind' => 'PORTRAIT', 'file' => UploadedFile::fake()->createWithContent('face.svg', '<svg></svg>')])->assertStatus(400);
        $this->post('/api/kyc/files', ['kind' => 'IDENTITY_FRONT', 'file' => UploadedFile::fake()->create('large.jpg', 4000, 'image/jpeg')])->assertStatus(400);
        $this->assertSame([], Storage::disk('local')->allFiles('kyc'));
    }

    public function test_submitted_documents_and_review_notes_survive_replacement_with_private_history(): void
    {
        $this->ready();
        $pending = $this->postJson('/api/kyc/submit', ['consent' => true])->assertOk()->json('data');
        $old = DB::table('KycFile')->where('kind', 'IDENTITY_FRONT')->first();
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)->patchJson('/api/admin/kyc/'.$pending['id'],
            ['action' => 'REQUEST_CHANGES', 'version' => $pending['version'], 'note' => 'Please provide a clearer image.'])->assertOk();
        $this->withUnencryptedCookie('qfs_session', $this->userToken)->post('/api/kyc/files', ['kind' => 'IDENTITY_FRONT', 'file' => $this->image()])->assertOk();
        $this->assertNotSame($old->id, DB::table('KycFile')->where('kind', 'IDENTITY_FRONT')->value('id'));
        Storage::disk('local')->assertExists($old->storagePath);
        $this->get('/api/kyc/files/'.$old->id)->assertOk();
        $history = $this->getJson('/api/kyc/history')->assertOk()->json('data.items');
        $this->assertSame('Please provide a clearer image.', $history[0]['reviewNote']);
        $this->assertStringNotContainsString('clearer image', DB::table('KycRevision')->where('event', 'REQUEST_CHANGES')->value('snapshot'));
        $this->assertSame($old->id, $history[0]['files'][0]['id']);
        $this->withUnencryptedCookie('qfs_session', $this->otherToken)->get('/api/kyc/files/'.$old->id)->assertNotFound();
        $this->getJson('/api/kyc/history')->assertOk()->assertJsonCount(0, 'data.items');
        $this->getJson('/api/admin/kyc/'.$pending['id'].'/history')->assertForbidden();
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)->getJson('/api/admin/kyc/'.$pending['id'].'/history')->assertOk()->assertJsonCount(2, 'data.items');
        $this->assertSame(1, DB::table('AuditLog')->where('action', 'KYC.HISTORY_VIEW')->count());
    }

    public function test_reverification_requires_reason_current_approval_and_preserves_the_review(): void
    {
        $this->ready();
        $pending = $this->postJson('/api/kyc/submit', ['consent' => true])->json('data');
        $url = '/api/admin/kyc/'.$pending['id'];
        $approved = $this->withUnencryptedCookie('qfs_session', $this->adminToken)->patchJson($url, ['action' => 'APPROVE', 'version' => $pending['version']])->assertOk()->json('data');
        $this->patchJson($url, ['action' => 'REVERIFY', 'version' => $approved['version']])->assertStatus(400);
        $this->patchJson($url, ['action' => 'REVERIFY', 'version' => $pending['version'], 'note' => 'Document has expired.'])->assertStatus(409);
        $this->patchJson($url, ['action' => 'REVERIFY', 'version' => $approved['version'], 'note' => 'Document has expired.'])->assertOk()->assertJsonPath('data.status', 'NEEDS_CHANGES');
        $this->assertSame(0, DB::table('User')->where('id', 'user')->value('kycLevel'));
        $this->getJson($url.'/history')->assertOk()->assertJsonPath('data.items.0.event', 'REVERIFY')->assertJsonPath('data.items.1.status', 'APPROVED');
        $this->withUnencryptedCookie('qfs_session', $this->userToken)->postJson('/api/kyc', $this->details())->assertOk();
        $this->postJson('/api/kyc/submit', ['consent' => true])->assertOk()->assertJsonPath('data.status', 'PENDING');
    }

    public function test_queue_search_and_status_filters_are_applied_before_pagination_beyond_one_hundred(): void
    {
        for ($i = 1; $i <= 130; $i++) {
            DB::table('User')->insert(['id' => 'queue-'.$i, 'name' => 'Queue Person '.$i, 'email' => 'queue'.$i.'@test.local']);
            DB::table('KycSubmission')->insert(['id' => 'submission-'.$i, 'userId' => 'queue-'.$i, 'status' => $i <= 120 ? 'APPROVED' : 'PENDING', 'submittedAt' => now()]);
        }
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)->getJson('/api/admin/kyc?status=PENDING')->assertOk()->assertJsonPath('data.total', 10)->assertJsonCount(10, 'data.items');
        $this->getJson('/api/admin/kyc?status=APPROVED&page=5')->assertOk()->assertJsonPath('data.total', 120)->assertJsonPath('data.totalPages', 5)->assertJsonCount(20, 'data.items');
        $this->getJson('/api/admin/kyc?search=queue130@test.local')->assertOk()->assertJsonPath('data.total', 1)->assertJsonPath('data.items.0.id', 'submission-130');
        $this->getJson('/api/admin/kyc?status=APPROVED&search=queue130@test.local')->assertOk()->assertJsonPath('data.total', 0);
        $this->getJson('/api/admin/kyc?search=%25')->assertOk()->assertJsonPath('data.total', 0);
        $this->getJson('/api/admin/kyc?search=%5F')->assertOk()->assertJsonPath('data.total', 0);
    }
}
