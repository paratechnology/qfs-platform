<?php

namespace App\Http\Controllers;

use App\Support\AdminLog;
use App\Support\Api;
use App\Support\Guard;
use App\Support\Qfs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Throwable;

final class DocumentFileController
{
    public function save(Request $request): JsonResponse
    {
        $admin = Guard::admin($request);
        $validator = Validator::make($request->all(), [
            'id' => 'sometimes|string|max:40',
            'code' => 'required|string|min:2|max:20',
            'title' => 'required|string|min:2|max:120',
            'flagPath' => 'required|string|max:300',
            'sort' => 'required|integer|min:0|max:10000',
            'isActive' => 'required|boolean',
            'file' => 'required|file|mimetypes:application/pdf|max:10240',
        ]);
        if ($validator->fails()) {
            Guard::fail('BAD_REQUEST', $validator->errors()->first(), 400);
        }
        $data = $validator->validated();
        if (! preg_match('~^(?!//)(/|https://)~i', $data['flagPath'])) {
            Guard::fail('BAD_REQUEST', 'Use a site path or an https:// link for the flag', 400);
        }
        $file = $request->file('file');
        $handle = fopen($file->getRealPath(), 'rb');
        $header = fread($handle, 5);
        fclose($handle);
        if ($header !== '%PDF-') {
            Guard::fail('BAD_REQUEST', 'Choose a valid PDF file', 400);
        }

        $id = $data['id'] ?? Qfs::id();
        $old = isset($data['id']) ? DB::table('Document')->where('id', $id)->first() : null;
        if (isset($data['id']) && ! $old) {
            Guard::fail('NOT_FOUND', 'Document not found', 404);
        }
        $name = Qfs::id().'.pdf';
        $path = Storage::disk('local')->putFileAs('documents', $file, $name);
        if (! $path) {
            Guard::fail('STORAGE_ERROR', 'Could not save the PDF', 500);
        }
        $fileUrl = '/api/documents/files/'.$name;

        try {
            DB::transaction(function () use ($data, $id, $old, $fileUrl, $admin): void {
                $fields = [
                    'code' => trim($data['code']), 'title' => trim($data['title']),
                    'flagPath' => $data['flagPath'], 'fileUrl' => $fileUrl,
                    'sort' => (int) $data['sort'], 'isActive' => (bool) $data['isActive'],
                ];
                if ($old) {
                    DB::table('Document')->where('id', $id)->update($fields);
                } else {
                    DB::table('Document')->insert(['id' => $id, ...$fields]);
                }
                AdminLog::audit($admin->id, $old ? 'DOCUMENT.UPDATE' : 'DOCUMENT.CREATE', 'Document', $id);
            });
        } catch (Throwable $error) {
            Storage::disk('local')->delete($path);
            throw $error;
        }
        if ($old) {
            self::deleteIfUnreferenced($old->fileUrl);
        }

        return Api::ok(DB::table('Document')->where('id', $id)->first());
    }

    public function show(Request $request, string $name): BinaryFileResponse
    {
        $user = Guard::user($request);
        if (! preg_match('/^[0-9A-HJKMNP-TV-Z]{26}\.pdf$/', $name)) {
            Guard::fail('NOT_FOUND', 'Document not found', 404);
        }
        $url = '/api/documents/files/'.$name;
        $query = DB::table('Document')->where('fileUrl', $url);
        if ($user->role !== 'ADMIN') {
            $query->where('isActive', true);
        }
        $snapshot = DB::table('Investment')->where('userId', $user->id)->where('materials', 'like', '%'.$url.'%')->exists();
        if ((! $query->exists() && ! $snapshot) || ! Storage::disk('local')->exists('documents/'.$name)) {
            Guard::fail('NOT_FOUND', 'Document not found', 404);
        }

        return response()->file(Storage::disk('local')->path('documents/'.$name), [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'inline; filename="document.pdf"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public static function deleteIfUnreferenced(string $url): void
    {
        if (! preg_match('~^/api/documents/files/([0-9A-HJKMNP-TV-Z]{26}\.pdf)$~', $url, $matches)) {
            return;
        }
        if (DB::table('Document')->where('fileUrl', $url)->exists()) {
            return;
        }
        if (DB::table('Investment')->where('materials', 'like', '%'.$url.'%')->exists()) {
            return;
        }
        Storage::disk('local')->delete('documents/'.$matches[1]);
    }
}
