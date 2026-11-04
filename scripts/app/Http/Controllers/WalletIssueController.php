<?php

namespace App\Http\Controllers;

use App\Support\AdminLog;
use App\Support\Api;
use App\Support\Guard;
use App\Support\Qfs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Validator;

final class WalletIssueController
{
    private const SUBJECTS = ['WALLET_NOT_DETECTED', 'CONNECT_FAILED', 'WRONG_NETWORK', 'OTHER'];

    public function store(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $key = 'wallet:issue:'.$user->id;
        if (RateLimiter::tooManyAttempts($key, 3)) {
            Guard::fail('TOO_MANY_REQUESTS', 'Please wait before submitting another wallet report.', 429);
        }
        $validator = Validator::make($request->all(), [
            'subject' => ['required', 'string', 'in:'.implode(',', self::SUBJECTS)],
            'message' => ['required', 'string', 'min:10', 'max:2000'],
            'pageUrl' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);
        if ($validator->fails()) {
            Guard::fail('BAD_REQUEST', $validator->errors()->first(), 400);
        }
        $data = $validator->validated();
        RateLimiter::hit($key, 24 * 60 * 60);
        $id = Qfs::id();
        $now = Qfs::now();
        DB::table('WalletIssue')->insert([
            'id' => $id,
            'userId' => $user->id,
            'subject' => $data['subject'],
            'message' => trim($data['message']),
            'status' => 'OPEN',
            'userAgent' => mb_substr((string) $request->userAgent(), 0, 400) ?: null,
            'pageUrl' => $this->pageUrl($data['pageUrl'] ?? null),
            'createdAt' => $now,
            'updatedAt' => $now,
        ]);
        DB::table('AuditLog')->insert([
            'id' => Qfs::id(), 'actorId' => $user->id, 'actorRole' => 'USER',
            'action' => 'WALLET_ISSUE.CREATE', 'targetType' => 'WalletIssue', 'targetId' => $id,
        ]);

        return Api::ok(['id' => $id, 'status' => 'OPEN']);
    }

    public function index(Request $request): JsonResponse
    {
        Guard::admin($request);
        $status = strtoupper((string) $request->query('status', 'OPEN'));
        $page = max(1, (int) $request->query('page', 1));
        $limit = min(100, max(1, (int) $request->query('limit', 20)));
        $query = DB::table('WalletIssue as i')
            ->join('User as u', 'u.id', '=', 'i.userId')
            ->select('i.*', 'u.name as userName', 'u.email as userEmail');
        if (in_array($status, ['OPEN', 'RESOLVED'], true)) {
            $query->where('i.status', $status);
        }
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('i.createdAt')->offset(($page - 1) * $limit)->limit($limit)->get();

        return Api::ok([
            'items' => $rows->map(fn ($row) => [
                'id' => $row->id,
                'userId' => $row->userId,
                'userName' => $row->userName,
                'userEmail' => $row->userEmail,
                'subject' => $row->subject,
                'message' => $row->message,
                'status' => $row->status,
                'userAgent' => $row->userAgent,
                'pageUrl' => $row->pageUrl,
                'resolvedAt' => $row->resolvedAt,
                'createdAt' => $row->createdAt,
            ])->all(),
            'total' => $total,
            'page' => $page,
            'totalPages' => max(1, (int) ceil($total / $limit)),
        ]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $admin = Guard::admin($request);
        $validator = Validator::make($request->all(), ['action' => 'required|in:RESOLVE']);
        if ($validator->fails()) {
            Guard::fail('BAD_REQUEST', $validator->errors()->first(), 400);
        }
        $item = DB::table('WalletIssue')->where('id', $id)->first();
        if (! $item) {
            Guard::fail('NOT_FOUND', 'Wallet issue not found.', 404);
        }
        $now = Qfs::now();
        DB::table('WalletIssue')->where('id', $id)->update([
            'status' => 'RESOLVED',
            'resolvedById' => $admin->id,
            'resolvedAt' => $now,
            'updatedAt' => $now,
        ]);
        AdminLog::audit($admin->id, 'WALLET_ISSUE.RESOLVE', 'WalletIssue', $id);

        return Api::ok(['id' => $id, 'status' => 'RESOLVED']);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $admin = Guard::admin($request);
        $deleted = DB::table('WalletIssue')->where('id', $id)->delete();
        if (! $deleted) {
            Guard::fail('NOT_FOUND', 'Wallet issue not found.', 404);
        }
        AdminLog::audit($admin->id, 'WALLET_ISSUE.DELETE', 'WalletIssue', $id);

        return Api::ok(['deleted' => true, 'id' => $id]);
    }

    private function pageUrl(?string $url): ?string
    {
        $url = trim((string) $url);
        if ($url === '') {
            return null;
        }
        if (! str_starts_with($url, '/') && ! preg_match('#^https?://#i', $url)) {
            return null;
        }

        return mb_substr($url, 0, 500);
    }
}
