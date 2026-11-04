<?php

namespace App\Support;

use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

final class KycHistory
{
    /** Caller holds the submission lock. Existing documents are referenced, not duplicated. */
    public static function capture(object $row, string $event, ?string $actorId): void
    {
        if (DB::table('KycRevision')->where('submissionId', $row->id)->where('version', $row->version)->exists()) {
            return;
        }
        $files = DB::table('KycFile')->where('submissionId', $row->id)->get();
        foreach ($files as $file) {
            DB::table('KycArchivedFile')->insertOrIgnore((array) $file);
        }
        $snapshot = ['status' => $row->status, 'submittedAt' => $row->submittedAt, 'consentAt' => $row->consentAt,
            'reviewedAt' => $row->reviewedAt, 'reviewedById' => $row->reviewedById,
            'reviewNote' => $row->reviewNote ? Crypt::decryptString($row->reviewNote) : null,
            'details' => $row->details ? json_decode(Crypt::decryptString($row->details), true) : [],
            'files' => $files->map(fn ($file) => ['id' => $file->id, 'kind' => $file->kind, 'mimeType' => $file->mimeType,
                'size' => $file->size, 'url' => '/api/kyc/files/'.$file->id])->all()];
        DB::table('KycRevision')->insert(['id' => Qfs::id(), 'submissionId' => $row->id, 'version' => $row->version,
            'event' => $event, 'actorId' => $actorId, 'snapshot' => Crypt::encryptString(json_encode($snapshot))]);
    }
}
