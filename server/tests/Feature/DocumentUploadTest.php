<?php

namespace Tests\Feature;

use App\Support\SessionAuth;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class DocumentUploadTest extends TestCase
{
    private string $adminToken;

    private string $userToken;

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
            $t->string('role');
            $t->string('status')->default('ACTIVE');
            $t->string('avatarUrl')->default('');
            $t->string('country')->default('');
            $t->string('referralCode')->default('');
            $t->timestamp('memberSince')->useCurrent();
            $t->integer('kycLevel')->default(0);
        });
        Schema::create('Session', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('tokenHash');
            $t->timestamp('expiresAt');
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('Document', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('code')->unique();
            $t->string('title');
            $t->string('flagPath');
            $t->string('fileUrl');
            $t->integer('sort');
            $t->boolean('isActive');
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
        Schema::create('Investment', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->text('materials')->nullable();
        });
        DB::table('User')->insert([
            ['id' => 'admin-1', 'email' => 'admin@test.local', 'name' => 'Admin', 'role' => 'ADMIN'],
            ['id' => 'user-1', 'email' => 'user@test.local', 'name' => 'User', 'role' => 'USER'],
        ]);
        $this->adminToken = SessionAuth::issue('admin-1');
        $this->userToken = SessionAuth::issue('user-1');
    }

    private function pdf(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('guide.pdf', "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
    }

    private function upload(array $changes = []): array
    {
        return [
            'code' => 'GUIDE', 'title' => 'User guide', 'flagPath' => '/flags/uk.svg',
            'sort' => '1', 'isActive' => '1', 'file' => $this->pdf(), ...$changes,
        ];
    }

    public function test_admin_upload_is_served_to_user_and_replacement_cleans_up_old_file(): void
    {
        $doc = $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->post('/api/admin/documents/upload', $this->upload())->assertOk()->json('data');
        $name = basename($doc['fileUrl']);
        Storage::disk('local')->assertExists('documents/'.$name);
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->get($doc['fileUrl'])->assertOk()->assertHeader('Content-Type', 'application/pdf');

        $updated = $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->post('/api/admin/documents/upload', $this->upload(['id' => $doc['id'], 'title' => 'New guide']))
            ->assertOk()->json('data');
        $this->assertSame('New guide', $updated['title']);
        Storage::disk('local')->assertMissing('documents/'.$name);
        Storage::disk('local')->assertExists('documents/'.basename($updated['fileUrl']));

        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->deleteJson('/api/admin/documents/'.$doc['id'])->assertOk();
        Storage::disk('local')->assertMissing('documents/'.basename($updated['fileUrl']));
    }

    public function test_upload_requires_admin_and_valid_pdf_and_inactive_file_is_hidden(): void
    {
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->post('/api/admin/documents/upload', $this->upload())->assertForbidden();
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->post('/api/admin/documents/upload', $this->upload([
                'file' => UploadedFile::fake()->createWithContent('guide.pdf', 'not a PDF'),
            ]))->assertStatus(400);
        $doc = $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->post('/api/admin/documents/upload', $this->upload(['isActive' => '0']))
            ->assertOk()->json('data');
        $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->get($doc['fileUrl'])->assertNotFound();
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->get($doc['fileUrl'])->assertOk();
    }

    public function test_original_document_stays_available_only_to_snapshot_owner_after_replacement(): void
    {
        $doc = $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->post('/api/admin/documents/upload', $this->upload())->assertOk()->json('data');
        DB::table('Investment')->insert(['id' => 'inv', 'userId' => 'user-1',
            'materials' => json_encode(['documents' => [['fileUrl' => $doc['fileUrl']]]], JSON_UNESCAPED_SLASHES)]);
        $this->post('/api/admin/documents/upload', $this->upload(['id' => $doc['id']]))->assertOk();
        Storage::disk('local')->assertExists('documents/'.basename($doc['fileUrl']));
        $this->withUnencryptedCookie('qfs_session', $this->userToken)->get($doc['fileUrl'])->assertOk();
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)->get($doc['fileUrl'])->assertNotFound();
    }
}
