<?php

namespace App\Http\Controllers;

use App\Support\AdminLog;
use App\Support\Api;
use App\Support\Guard;
use App\Support\KycHistory;
use App\Support\Qfs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

final class KycController
{
    private function respond(mixed $data): JsonResponse
    {
        return Api::ok($data)->header('Cache-Control', 'private, no-store');
    }

    public static function summary(string $userId, int $level = 0): array
    {
        $row = DB::table('KycSubmission')->where('userId', $userId)->first();

        return ['status' => $row?->status ?? ($level > 0 ? 'APPROVED' : 'NOT_STARTED'),
            'submittedAt' => $row?->submittedAt, 'reviewedAt' => $row?->reviewedAt,
            'reviewNote' => $row?->reviewNote ? Crypt::decryptString($row->reviewNote) : null];
    }

    private function payload(?object $row, int $level = 0): array
    {
        return ['id' => $row?->id, 'version' => $row?->version ?? 0,
            'status' => $row?->status ?? ($level > 0 ? 'APPROVED' : 'NOT_STARTED'),
            'submittedAt' => $row?->submittedAt, 'reviewedAt' => $row?->reviewedAt,
            'reviewNote' => $row?->reviewNote ? Crypt::decryptString($row->reviewNote) : null,
            'details' => $row?->details ? json_decode(Crypt::decryptString($row->details), true) : (object) [],
            'files' => $row ? DB::table('KycFile')->where('submissionId', $row->id)->get()
                ->map(fn ($file) => ['id' => $file->id, 'kind' => $file->kind, 'mimeType' => $file->mimeType,
                    'size' => $file->size, 'url' => '/api/kyc/files/'.$file->id])->all() : []];
    }

    private function editable(object $user): object
    {
        $current = DB::table('User')->where('id', $user->id)->lockForUpdate()->first();
        $row = DB::table('KycSubmission')->where('userId', $user->id)->lockForUpdate()->first();
        if ($current->kycLevel > 0 || ($row && in_array($row->status, ['PENDING', 'APPROVED'], true))) {
            Guard::fail('CONFLICT', 'Verification is already submitted or approved.', 409);
        }
        if (! $row) {
            $id = Qfs::id();
            DB::table('KycSubmission')->insert(['id' => $id, 'userId' => $user->id]);
            $row = DB::table('KycSubmission')->where('id', $id)->first();
        }

        return $row;
    }

    private function detailsRules(): array
    {
        return ['legalName' => 'required|string|min:2|max:120',
            'dateOfBirth' => 'required|date_format:Y-m-d|before:today|after_or_equal:1900-01-01',
            'country' => 'required|string|min:2|max:80', 'address' => 'required|string|min:5|max:500',
            'documentType' => 'required|in:PASSPORT,NATIONAL_ID,DRIVING_LICENSE'];
    }

    public function show(Request $request): JsonResponse
    {
        $user = Guard::user($request);

        return $this->respond($this->payload(DB::table('KycSubmission')->where('userId', $user->id)->first(), $user->kycLevel));
    }

    public function save(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $details = array_map('trim', $request->validate($this->detailsRules()));
        $row = DB::transaction(function () use ($user, $details) {
            $row = $this->editable($user);
            if ($row->submittedAt) {
                KycHistory::capture($row, 'BASELINE', null);
            }
            DB::table('KycSubmission')->where('id', $row->id)->update([
                'details' => Crypt::encryptString(json_encode($details)),
                'version' => $row->version + 1, 'updatedAt' => Qfs::now()]);

            return DB::table('KycSubmission')->where('id', $row->id)->first();
        });

        return $this->respond($this->payload($row));
    }

    public function upload(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $data = $request->validate(['kind' => 'required|in:IDENTITY_FRONT,IDENTITY_BACK,PORTRAIT',
            'file' => 'required|file|mimetypes:image/jpeg,image/png,application/pdf|max:3072']);
        $file = $request->file('file');
        $mime = $file->getMimeType();
        if ($data['kind'] === 'PORTRAIT' && $mime === 'application/pdf') {
            Guard::fail('BAD_REQUEST', 'Your face photo must be a JPG or PNG image.', 400);
        }
        $path = 'kyc/'.Qfs::id().'.enc';
        if (! Storage::disk('local')->put($path, Crypt::encryptString(base64_encode(file_get_contents($file->getRealPath()))))) {
            Guard::fail('STORAGE_ERROR', 'Could not save your document. Please try again.', 500);
        }
        $previousPath = null;
        try {
            $row = DB::transaction(function () use ($user, $data, $path, $mime, $file, &$previousPath) {
                $row = $this->editable($user);
                if ($row->submittedAt) {
                    KycHistory::capture($row, 'BASELINE', null);
                }
                $old = DB::table('KycFile')->where('submissionId', $row->id)->where('kind', $data['kind'])->first();
                $previousPath = $old?->storagePath;
                DB::table('KycFile')->updateOrInsert(['submissionId' => $row->id, 'kind' => $data['kind']], [
                    'id' => Qfs::id(), 'storagePath' => $path, 'mimeType' => $mime, 'size' => $file->getSize(), 'createdAt' => Qfs::now()]);
                DB::table('KycSubmission')->where('id', $row->id)->update(['version' => $row->version + 1, 'updatedAt' => Qfs::now()]);

                return DB::table('KycSubmission')->where('id', $row->id)->first();
            });
        } catch (Throwable $error) {
            Storage::disk('local')->delete($path);
            throw $error;
        }
        if ($previousPath && ! DB::table('KycArchivedFile')->where('storagePath', $previousPath)->exists()) {
            Storage::disk('local')->delete($previousPath);
        }

        return $this->respond($this->payload($row));
    }

    public function submit(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $request->validate(['consent' => 'required|accepted']);
        $row = DB::transaction(function () use ($user) {
            $row = $this->editable($user);
            if ($row->submittedAt) {
                KycHistory::capture($row, 'BASELINE', null);
            }
            $details = $row->details ? json_decode(Crypt::decryptString($row->details), true) : [];
            validator($details, $this->detailsRules())->validate();
            $required = ['IDENTITY_FRONT', 'PORTRAIT'];
            if ($details['documentType'] !== 'PASSPORT') {
                $required[] = 'IDENTITY_BACK';
            }
            $files = DB::table('KycFile')->where('submissionId', $row->id)->get();
            foreach ($required as $kind) {
                $file = $files->firstWhere('kind', $kind);
                if (! $file || ! Storage::disk('local')->exists($file->storagePath)) {
                    Guard::fail('BAD_REQUEST', 'Upload all required documents before submitting.', 400);
                }
            }
            DB::table('KycSubmission')->where('id', $row->id)->update([
                'status' => 'PENDING', 'submittedAt' => Qfs::now(), 'consentAt' => Qfs::now(),
                'reviewedAt' => null, 'reviewedById' => null, 'reviewNote' => null,
                'version' => $row->version + 1, 'updatedAt' => Qfs::now()]);
            AdminLog::notify($user->id, 'Identity documents submitted', 'Your documents are awaiting admin review.');
            KycHistory::capture(DB::table('KycSubmission')->where('id', $row->id)->first(), 'SUBMITTED', $user->id);

            return DB::table('KycSubmission')->where('id', $row->id)->first();
        });

        return $this->respond($this->payload($row));
    }

    public function file(Request $request, string $id): Response
    {
        $user = Guard::user($request);
        $file = DB::table('KycFile')->join('KycSubmission', 'KycFile.submissionId', '=', 'KycSubmission.id')
            ->where('KycFile.id', $id)->select('KycFile.*', 'KycSubmission.userId')->first();
        if (! $file) {
            $file = DB::table('KycArchivedFile')->join('KycSubmission', 'KycArchivedFile.submissionId', '=', 'KycSubmission.id')
                ->where('KycArchivedFile.id', $id)->select('KycArchivedFile.*', 'KycSubmission.userId')->first();
        }
        if (! $file || ($file->userId !== $user->id && $user->role !== 'ADMIN')) {
            Guard::fail('NOT_FOUND', 'Document not found.', 404);
        }
        if (! Storage::disk('local')->exists($file->storagePath)) {
            Guard::fail('NOT_FOUND', 'Document not found.', 404);
        }
        if ($user->role === 'ADMIN') {
            AdminLog::audit($user->id, 'KYC.FILE_VIEW', 'KycSubmission', $file->submissionId, ['fileId' => $id]);
        }
        $bytes = base64_decode(Crypt::decryptString(Storage::disk('local')->get($file->storagePath)), true);
        $extension = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'application/pdf' => 'pdf'][$file->mimeType];

        return response($bytes, 200, ['Content-Type' => $file->mimeType,
            'Content-Disposition' => 'attachment; filename="verification-document.'.$extension.'"',
            'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function queue(Request $request): JsonResponse
    {
        Guard::admin($request);
        $data = $request->validate(['status' => 'nullable|in:ALL,PENDING,NEEDS_CHANGES,APPROVED',
            'search' => 'nullable|string|max:200', 'page' => 'nullable|integer|min:1']);
        $search = '%'.mb_strtolower(str_replace(['!', '%', '_'], ['!!', '!%', '!_'], trim($data['search'] ?? ''))).'%';
        $query = DB::table('KycSubmission')->join('User', 'User.id', '=', 'KycSubmission.userId')
            ->whereIn('KycSubmission.status', ['PENDING', 'NEEDS_CHANGES', 'APPROVED'])
            ->when(($data['status'] ?? 'ALL') !== 'ALL', fn ($query) => $query->where('KycSubmission.status', $data['status']))
            ->when(trim($data['search'] ?? '') !== '', fn ($query) => $query->where(fn ($query) => $query
                ->whereRaw('LOWER('.DB::getQueryGrammar()->wrap('User.email').") LIKE ? ESCAPE '!'", [$search])
                ->orWhereRaw('LOWER('.DB::getQueryGrammar()->wrap('User.name').") LIKE ? ESCAPE '!'", [$search])));
        $total = (clone $query)->count();
        $page = min((int) ($data['page'] ?? 1), max(1, (int) ceil($total / 25)));
        $rows = $query
            ->orderByRaw('CASE WHEN '.DB::getQueryGrammar()->wrap('KycSubmission.status').' = ? THEN 0 ELSE 1 END', ['PENDING'])
            ->orderByDesc('KycSubmission.submittedAt')->orderBy('KycSubmission.id')->offset(($page - 1) * 25)->limit(25)
            ->select('KycSubmission.*', 'User.name as userName', 'User.email')->get();

        return $this->respond(['items' => $rows->map(fn ($row) => ['id' => $row->id, 'userName' => $row->userName,
            'email' => $row->email, 'status' => $row->status, 'submittedAt' => $row->submittedAt,
            'reviewedAt' => $row->reviewedAt, 'version' => $row->version])->all(), 'total' => $total, 'page' => $page, 'totalPages' => (int) ceil($total / 25)]);
    }

    public function reviewDetails(Request $request, string $id): JsonResponse
    {
        $admin = Guard::admin($request);
        $row = DB::table('KycSubmission')->where('id', $id)->first();
        if (! $row) {
            Guard::fail('NOT_FOUND', 'Submission not found.', 404);
        }
        AdminLog::audit($admin->id, 'KYC.REVIEW_VIEW', 'KycSubmission', $id);

        return $this->respond($this->payload($row));
    }

    public function decide(Request $request, string $id): JsonResponse
    {
        $admin = Guard::admin($request);
        $data = $request->validate(['action' => 'required|in:APPROVE,REQUEST_CHANGES,REVERIFY',
            'version' => 'required|integer|min:1', 'note' => 'required_if:action,REQUEST_CHANGES,REVERIFY|nullable|string|min:3|max:1000']);
        $row = DB::transaction(function () use ($id, $admin, $data) {
            $owner = DB::table('KycSubmission')->where('id', $id)->value('userId');
            if ($owner) {
                DB::table('User')->where('id', $owner)->lockForUpdate()->first();
            }
            $row = DB::table('KycSubmission')->where('id', $id)->lockForUpdate()->first();
            if (! $row) {
                Guard::fail('NOT_FOUND', 'Submission not found.', 404);
            }
            $expected = $data['action'] === 'REVERIFY' ? 'APPROVED' : 'PENDING';
            if ($row->status !== $expected || $row->version !== (int) $data['version']) {
                Guard::fail('CONFLICT', 'This submission changed or was already reviewed. Reload before deciding.', 409);
            }
            $status = $data['action'] === 'APPROVE' ? 'APPROVED' : 'NEEDS_CHANGES';
            KycHistory::capture($row, 'BASELINE', null);
            $note = trim($data['note'] ?? '') ?: null;
            DB::table('KycSubmission')->where('id', $id)->update([
                'status' => $status, 'reviewedAt' => Qfs::now(), 'reviewedById' => $admin->id,
                'reviewNote' => $note ? Crypt::encryptString($note) : null,
                'version' => $row->version + 1, 'updatedAt' => Qfs::now()]);
            DB::table('User')->where('id', $row->userId)->update(['kycLevel' => $status === 'APPROVED' ? 1 : 0]);
            KycHistory::capture(DB::table('KycSubmission')->where('id', $id)->first(), $data['action'], $admin->id);
            AdminLog::audit($admin->id, 'KYC.'.$data['action'], 'KycSubmission', $id, ['version' => $row->version]);
            AdminLog::notify($row->userId, $status === 'APPROVED' ? 'Identity verification approved' : 'Verification needs changes',
                $status === 'APPROVED' ? 'Your identity documents were approved.' : 'Open identity verification to see the requested changes.');

            return DB::table('KycSubmission')->where('id', $id)->first();
        });

        return $this->respond($this->payload($row));
    }

    public function history(Request $request, ?string $id = null): JsonResponse
    {
        $user = $id ? Guard::admin($request) : Guard::user($request);
        $row = $id ? DB::table('KycSubmission')->where('id', $id)->first() : DB::table('KycSubmission')->where('userId', $user->id)->first();
        if (! $row) {
            return $this->respond(['items' => [], 'nextCursor' => null]);
        }
        if ($id) {
            AdminLog::audit($user->id, 'KYC.HISTORY_VIEW', 'KycSubmission', $row->id);
        }
        $data = $request->validate(['beforeVersion' => 'nullable|integer|min:1']);
        $rows = DB::table('KycRevision')->where('submissionId', $row->id)
            ->when(isset($data['beforeVersion']), fn ($q) => $q->where('version', '<', $data['beforeVersion']))
            ->orderByDesc('version')->limit(11)->get();
        $items = $rows->take(10)->map(fn ($revision) => ['id' => $revision->id, 'version' => $revision->version,
            'event' => $revision->event, 'createdAt' => $revision->createdAt,
            ...json_decode(Crypt::decryptString($revision->snapshot), true)])->all();

        return $this->respond(['items' => $items, 'nextCursor' => $rows->count() > 10 ? $items[9]['version'] : null]);
    }
}
