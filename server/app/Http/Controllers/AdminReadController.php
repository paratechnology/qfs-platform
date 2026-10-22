<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\CryptoAssets;
use App\Support\CryptoFunds;
use App\Support\Guard;
use App\Support\Qfs;
use App\Support\Search;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class AdminReadController
{
    private function page(Request $request, $query, callable $map): array
    {
        $page = max(1, (int) $request->query('page', 1));
        $limit = min(100, max(1, (int) $request->query('limit', 20)));
        $total = (clone $query)->count();
        $rows = $query->orderByDesc($query->from.'.createdAt')->offset(($page - 1) * $limit)->limit($limit)->get();

        return ['items' => $rows->map($map)->all(), 'total' => $total,
            'page' => $page, 'totalPages' => max(1, (int) ceil($total / $limit))];
    }

    public function stats(Request $request): JsonResponse
    {
        Guard::admin($request);
        $monthAgo = now()->subMonth();
        $balance = (int) DB::table('Account')->sum('balanceCents');
        $deposits = (int) DB::table('Transaction')->where('type', 'DEPOSIT')->where('status', 'COMPLETED')->sum('amountCents');
        $withdrawals = (int) DB::table('Transaction')->where('type', 'WITHDRAWAL')->where('status', 'COMPLETED')->sum('amountCents');
        $pendingDeposits = DB::table('DepositRequest')->where('status', 'PENDING');
        $pendingWithdrawals = DB::table('WithdrawalRequest')->where('status', 'PENDING');
        $activeInvestments = DB::table('Investment')->where('status', 'ACTIVE');

        return Api::ok([
            'totalUsers' => DB::table('User')->count(),
            'newUsers30d' => DB::table('User')->where('createdAt', '>=', $monthAgo)->count(),
            'activeUsers' => DB::table('User')->where('role', 'USER')->where('status', 'ACTIVE')->count(),
            'suspendedUsers' => DB::table('User')->where('status', 'SUSPENDED')->count(),
            'totalBalanceCents' => $balance, 'totalBalance' => Qfs::money($balance),
            'totalDepositsCents' => $deposits, 'totalDeposits' => Qfs::money($deposits),
            'totalWithdrawalsCents' => $withdrawals, 'totalWithdrawals' => Qfs::money($withdrawals),
            'pendingDeposits' => ['count' => (clone $pendingDeposits)->count(), 'sumCents' => (int) $pendingDeposits->sum('amountCents')],
            'pendingWithdrawals' => ['count' => (clone $pendingWithdrawals)->count(), 'sumCents' => (int) $pendingWithdrawals->sum('amountCents')],
            'pendingLoans' => DB::table('Loan')->where('status', 'PENDING')->count(),
            'activeInvestments' => (clone $activeInvestments)->count(),
            'activeInvestmentsCents' => (int) $activeInvestments->sum('amountCents'),
            'totalPlans' => DB::table('InvestmentPlan')->where('isActive', true)->count(),
            'approvals30d' => DB::table('AuditLog')->where('createdAt', '>=', $monthAgo)->count(),
        ]);
    }

    public function users(Request $request): JsonResponse
    {
        Guard::admin($request);
        $query = DB::table('User');
        if ($search = trim((string) $request->query('search', ''))) {
            $like = Search::pattern($search);
            $query->where(function ($q) use ($like) {
                foreach (['name', 'email', 'phone', 'referralCode'] as $column) {
                    Search::match($q, $column, $like, 'or');
                }
                $q->orWhereExists(fn ($sub) => $sub->selectRaw('1')->from('WalletConnection')
                    ->whereColumn('WalletConnection.userId', 'User.id')->where(fn ($q) => Search::match($q, 'address', $like)));
            });
        }
        foreach (['role', 'status'] as $filter) {
            $value = $request->query($filter);
            if ($value && $value !== 'ALL') {
                $query->where($filter, $value);
            }
        }

        return Api::ok($this->page($request, $query, function ($u) {
            $account = DB::table('Account')->where('userId', $u->id)->first();
            $sum = fn ($type) => (int) DB::table('Transaction')->where('userId', $u->id)->where('type', $type)
                ->where('status', 'COMPLETED')->sum('amountCents');

            return [
                'id' => $u->id, 'name' => $u->name, 'email' => $u->email, 'phone' => $u->phone,
                'avatarUrl' => $u->avatarUrl, 'role' => $u->role, 'status' => $u->status,
                'country' => $u->country, 'kycLevel' => $u->kycLevel,
                'balanceCents' => $account?->balanceCents ?? 0, 'availableCents' => $account?->availableCents ?? 0,
                'cryptoBalances' => DB::table('CryptoBalance')->where('userId', $u->id)->get()
                    ->filter(fn ($balance) => $balance->totalAtomic !== '0')->map(fn ($balance) => [
                        'assetKey' => $balance->assetKey,
                        'symbol' => CryptoAssets::get($balance->assetKey)['symbol'],
                        'network' => CryptoAssets::get($balance->assetKey)['network'],
                        'quantity' => CryptoAssets::quantity($balance->assetKey, $balance->totalAtomic),
                        'reserved' => CryptoAssets::quantity($balance->assetKey, $balance->reservedAtomic),
                    ])->values(),
                'depositCents' => $sum('DEPOSIT'), 'withdrawalCents' => $sum('WITHDRAWAL'),
                'memberSince' => date(DATE_ATOM, strtotime($u->memberSince)),
                'lastLoginAt' => $u->lastLoginAt ? date(DATE_ATOM, strtotime($u->lastLoginAt)) : null,
                'referralCode' => $u->referralCode,
                'referredCount' => DB::table('User')->where('referredById', $u->id)->count(),
                'walletAddress' => DB::table('WalletConnection')->where('userId', $u->id)
                    ->orderByDesc('lastUsedAt')->value('address'),
            ];
        }));
    }

    public function requests(Request $request): JsonResponse
    {
        Guard::admin($request);
        $table = $request->query('type') === 'WITHDRAWAL' ? 'WithdrawalRequest' : 'DepositRequest';
        $query = DB::table($table)->join('User', "$table.userId", '=', 'User.id')
            ->select("$table.*", 'User.name as userName', 'User.email as userEmail');
        if ($userId = $request->query('userId')) {
            $query->where("$table.userId", $userId);
        }
        if ($status = $request->query('status')) {
            if ($status !== 'ALL') {
                $query->where("$table.status", $status);
            }
        }

        return Api::ok($this->page($request, $query, fn ($r) => [
            'id' => $r->id, 'userId' => $r->userId,
            'userName' => $r->userName, 'userEmail' => $r->userEmail,
            'amountCents' => $r->amountCents, 'amount' => CryptoFunds::transactionAmount($r),
            'method' => $r->method, 'reference' => $r->reference,
            'details' => $r->details ?? null, 'walletAddress' => $r->walletAddress,
            ...CryptoFunds::requestInfo($r),
            'status' => $r->status, 'createdAt' => date(DATE_ATOM, strtotime($r->createdAt)),
            'adminNote' => $r->adminNote,
        ]));
    }

    public function transactions(Request $request): JsonResponse
    {
        Guard::admin($request);
        $query = DB::table('Transaction')->join('User', 'Transaction.userId', '=', 'User.id')
            ->select('Transaction.*', 'User.name as userName', 'User.email as userEmail');
        foreach (['type', 'status'] as $filter) {
            $value = $request->query($filter);
            if ($value && $value !== 'ALL') {
                $query->where('Transaction.'.$filter, $value);
            }
        }

        return Api::ok($this->page($request, $query, fn ($t) => [
            'id' => $t->id, 'userName' => $t->userName, 'userEmail' => $t->userEmail,
            'type' => $t->type, 'amount' => CryptoFunds::transactionAmount($t),
            'currency' => $t->currency, 'status' => $t->status,
            'reference' => $t->reference, 'method' => $t->method,
            'createdAt' => date(DATE_ATOM, strtotime($t->createdAt)), 'note' => $t->note,
        ]));
    }

    public function loans(Request $request): JsonResponse
    {
        Guard::admin($request);
        $query = DB::table('Loan')->join('User', 'Loan.userId', '=', 'User.id')
            ->select('Loan.*', 'User.name as userName', 'User.email as userEmail');
        if ($userId = $request->query('userId')) {
            $query->where('Loan.userId', $userId);
        }
        if ($status = $request->query('status')) {
            if ($status !== 'ALL') {
                $query->where('Loan.status', $status);
            }
        }

        return Api::ok($this->page($request, $query, fn ($l) => [
            'id' => $l->id, 'userName' => $l->userName, 'userEmail' => $l->userEmail,
            'type' => $l->type, 'currency' => $l->currency,
            'amount' => Qfs::money($l->amountCents), 'amountCents' => $l->amountCents,
            'period' => $l->period, 'status' => $l->status,
            'createdAt' => date(DATE_ATOM, strtotime($l->createdAt)), 'adminNote' => $l->adminNote,
        ]));
    }

    public function audit(Request $request): JsonResponse
    {
        Guard::admin($request);
        $query = DB::table('AuditLog')->join('User', 'AuditLog.actorId', '=', 'User.id')
            ->select('AuditLog.*', 'User.name as actorName');

        return Api::ok($this->page($request, $query, fn ($a) => [
            'id' => $a->id, 'actorName' => $a->actorName, 'actorRole' => $a->actorRole,
            'action' => $a->action, 'targetType' => $a->targetType, 'targetId' => $a->targetId,
            'meta' => $a->meta, 'createdAt' => date(DATE_ATOM, strtotime($a->createdAt)),
        ]));
    }
}
