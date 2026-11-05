<?php

namespace App\Http\Controllers;

use App\Support\AdminLog;
use App\Support\Api;
use App\Support\CryptoAssets;
use App\Support\Guard;
use App\Support\Qfs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Validator;

final class WalletIssueController
{
    private const SUBJECTS = ['WALLET_NOT_DETECTED', 'CONNECT_FAILED', 'WRONG_NETWORK', 'OTHER', 'MANUAL_REVIEW'];

    public const PROVIDERS = ['Ledger', 'MetaMask', 'Phantom', 'Electrum', 'Exodus', 'Trust Wallet', 'Other'];

    public function store(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $key = 'wallet:issue:'.$user->id;
        if (RateLimiter::tooManyAttempts($key, 3)) {
            Guard::fail('TOO_MANY_REQUESTS', 'Please wait before submitting another wallet report.', 429);
        }
        $validator = Validator::make($request->all(), [
            'subject' => ['required', 'string', 'in:'.implode(',', self::SUBJECTS)],
            'message' => ['required_unless:subject,MANUAL_REVIEW', 'nullable', 'string', 'min:10', 'max:2000'],
            'walletProvider' => ['required_if:subject,MANUAL_REVIEW', 'nullable', 'in:'.implode(',', self::PROVIDERS)],
            'assetKey' => ['required_if:subject,MANUAL_REVIEW', 'nullable', 'in:'.implode(',', array_keys(CryptoAssets::ALL))],
            'publicAddress' => ['required_if:subject,MANUAL_REVIEW', 'nullable', 'string', 'max:200'],
            'seedPhrase' => 'prohibited', 'recoveryPhrase' => 'prohibited', 'privateKey' => 'prohibited',
            'verificationKey' => 'prohibited', 'mnemonic' => 'prohibited',
            'pageUrl' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);
        if ($validator->fails()) {
            Guard::fail('BAD_REQUEST', $validator->errors()->first(), 400);
        }
        $data = $validator->validated();
        $manual = $data['subject'] === 'MANUAL_REVIEW';
        $address = $manual ? CryptoAssets::address($data['assetKey'], $data['publicAddress']) : null;
        RateLimiter::hit($key, 24 * 60 * 60);
        $id = Qfs::id();
        $now = Qfs::now();
        DB::table('WalletIssue')->insert([
            'id' => $id,
            'userId' => $user->id,
            'subject' => $data['subject'],
            'message' => $manual ? 'Public address submitted for manual review. Wallet ownership has not been verified.' : trim($data['message']),
            'status' => $manual ? 'UNDER_REVIEW' : 'OPEN',
            'walletProvider' => $manual ? $data['walletProvider'] : null,
            'assetKey' => $manual ? $data['assetKey'] : null,
            'publicAddress' => $address,
            'userAgent' => mb_substr((string) $request->userAgent(), 0, 400) ?: null,
            'pageUrl' => $this->pageUrl($data['pageUrl'] ?? null),
            'createdAt' => $now,
            'updatedAt' => $now,
        ]);
        DB::table('AuditLog')->insert([
            'id' => Qfs::id(), 'actorId' => $user->id, 'actorRole' => 'USER',
            'action' => 'WALLET_ISSUE.CREATE', 'targetType' => 'WalletIssue', 'targetId' => $id,
        ]);

        return Api::ok(['id' => $id, 'status' => $manual ? 'UNDER_REVIEW' : 'OPEN']);
    }

    public function mine(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $items = DB::table('WalletIssue')->where('userId', $user->id)->where('subject', 'MANUAL_REVIEW')
            ->orderByDesc('createdAt')->limit(20)->get(['id', 'walletProvider', 'assetKey', 'publicAddress', 'status', 'reviewNote', 'createdAt', 'resolvedAt']);

        return Api::ok(['items' => $items]);
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
        if ($status === 'PENDING') {
            $query->whereIn('i.status', ['OPEN', 'UNDER_REVIEW']);
        } elseif (in_array($status, ['OPEN', 'RESOLVED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'], true)) {
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
                'walletProvider' => $row->walletProvider, 'assetKey' => $row->assetKey,
                'publicAddress' => $row->publicAddress, 'reviewNote' => $row->reviewNote,
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
        $data = $request->validate(['action' => 'required|in:RESOLVE,APPROVE,REJECT', 'note' => 'nullable|string|max:500']);
        $status = match ($data['action']) {
            'APPROVE' => 'APPROVED', 'REJECT' => 'REJECTED', default => 'RESOLVED',
        };
        DB::transaction(function () use ($admin, $id, $data, $status): void {
            $item = DB::table('WalletIssue')->where('id', $id)->lockForUpdate()->first();
            if (! $item) {
                Guard::fail('NOT_FOUND', 'Wallet issue not found.', 404);
            }
            $manual = $item->subject === 'MANUAL_REVIEW';
            if (($manual && $data['action'] === 'RESOLVE') || (! $manual && $data['action'] !== 'RESOLVE')) {
                Guard::fail('BAD_REQUEST', 'Choose an action appropriate for this report.', 400);
            }
            if ($item->status === $status) {
                return;
            }
            if (! in_array($item->status, ['OPEN', 'UNDER_REVIEW'], true)) {
                Guard::fail('CONFLICT', 'This report has already been reviewed.', 409);
            }
            $note = trim($data['note'] ?? '');
            if ($status === 'REJECTED' && mb_strlen($note) < 3) {
                Guard::fail('NOTE', 'Explain why this review was declined.', 400);
            }
            $now = Qfs::now();
            DB::table('WalletIssue')->where('id', $id)->update([
                'status' => $status, 'reviewNote' => $note ?: null, 'resolvedById' => $admin->id,
                'resolvedAt' => $now, 'updatedAt' => $now,
            ]);
            AdminLog::audit($admin->id, 'WALLET_ISSUE.'.$data['action'], 'WalletIssue', $id);
            if ($manual) {
                AdminLog::notify($item->userId, $status === 'APPROVED' ? 'Wallet review approved' : 'Wallet review declined',
                    $status === 'APPROVED'
                        ? 'An administrator approved your public-address review. This does not verify wallet ownership or change your wallet security. Sign a wallet message to connect.'
                        : 'Your public-address review was declined. Open Secure Wallet for the review note or contact support.');
            }
        });

        return Api::ok(['id' => $id, 'status' => $status]);
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
