<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\CryptoFunds;
use App\Support\Guard;
use App\Support\LiveQuotes;
use App\Support\LocalizedText;
use App\Support\Qfs;
use App\Support\Search;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Validator;

final class UserController
{
    public function loans(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $rows = DB::table('Loan')->where('userId', $user->id)->orderByDesc('createdAt')->limit(20)->get();

        return Api::ok($rows);
    }

    public function applyLoan(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'gt:0', 'max:1000000'],
            'type' => ['required', 'string', 'min:2', 'max:80'],
            'period' => ['required', 'integer', 'min:1', 'max:60'],
            'occupation' => ['required', 'string', 'min:2', 'max:120'],
            'currency' => ['required', 'string', 'max:40'],
        ]);
        $cents = Qfs::cents($data['amount']);
        if (! $cents) {
            Guard::fail('BAD_REQUEST', 'Amount can have at most 2 decimal places', 400);
        }
        $loan = DB::transaction(function () use ($user, $data, $cents) {
            DB::table('Account')->where('userId', $user->id)->lockForUpdate()->first();
            if (DB::table('Loan')->where('userId', $user->id)->where('status', 'PENDING')->exists()) {
                Guard::fail('CONFLICT', 'You already have a loan application under review.', 409);
            }
            $id = Qfs::id();
            DB::table('Loan')->insert([
                'id' => $id, 'userId' => $user->id, 'type' => trim($data['type']),
                'currency' => trim($data['currency']), 'amountCents' => $cents,
                'period' => (int) ($data['period'] ?: 12) ?: 12,
                'occupation' => trim($data['occupation']),
            ]);

            return DB::table('Loan')->where('id', $id)->first();
        });

        return Api::ok($loan);
    }

    public function notifications(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $items = DB::table('Notification')->where('userId', $user->id)->orderByDesc('createdAt')->limit(30)->get()
            ->map(fn ($n) => [
                'id' => $n->id, ...LocalizedText::notification($n),
                'link' => $n->link, 'read' => $n->readAt !== null,
                'createdAt' => date(DATE_ATOM, strtotime($n->createdAt)),
            ]);
        $unread = DB::table('Notification')->where('userId', $user->id)->whereNull('readAt')->count();

        return Api::ok(['items' => $items, 'unread' => $unread]);
    }

    public function readNotifications(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $id = $request->input('id');
        $query = DB::table('Notification')->where('userId', $user->id);
        if (is_string($id) && $id !== '') {
            $query->where('id', $id);
            if (! (clone $query)->exists()) {
                Guard::fail('NOT_FOUND', 'Notification not found', 404);
            }
        }
        $query->whereNull('readAt')->update(['readAt' => Qfs::now()]);

        return Api::ok(['read' => true]);
    }

    public function transactions(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $limit = min(100, max(1, (int) $request->query('limit', 15)));
        $query = DB::table('Transaction')->where('userId', $user->id);
        if ($id = $request->query('id')) {
            $query->where('id', $id);
        }
        if ($type = $request->query('type')) {
            $query->where('type', $type);
        }
        if ($cursor = $request->query('cursor')) {
            $anchor = DB::table('Transaction')->where('id', $cursor)->where('userId', $user->id)->first();
            if ($anchor) {
                $query->where(fn ($q) => $q->where('createdAt', '<', $anchor->createdAt)
                    ->orWhere(fn ($q) => $q->where('createdAt', $anchor->createdAt)->where('id', '<', $anchor->id)));
            }
        }
        $rows = $query->orderByDesc('createdAt')->orderByDesc('id')->limit($limit + 1)->get();
        $hasMore = $rows->count() > $limit;
        $items = $rows->take($limit)->map(function ($t) {
            $labels = ['DEPOSIT' => 'Deposit', 'WITHDRAWAL' => 'Withdrawal', 'INVESTMENT' => 'Investment',
                'EARNING' => 'Earning', 'REFERRAL_BONUS' => 'Referral Bonus', 'LOAN' => 'Loan', 'ADJUSTMENT' => 'Adjustment', 'PRINCIPAL_RETURN' => 'Principal return', 'SWAP' => 'Crypto swap'];

            return ['id' => $t->id, 'type' => $t->type, 'label' => LocalizedText::translate($labels[$t->type] ?? $t->type),
                'amount' => CryptoFunds::transactionAmount($t), 'amountCents' => $t->amountCents,
                'status' => $t->status, 'method' => $t->method, 'note' => LocalizedText::translate($t->note),
                'reference' => $t->reference, 'createdAt' => date(DATE_ATOM, strtotime($t->createdAt))];
        })->values();

        return Api::ok(['items' => $items, 'nextCursor' => $hasMore ? $rows[$limit - 1]->id : null]);
    }

    public function withdrawals(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $items = DB::table('WithdrawalRequest')->where('userId', $user->id)
            ->orderByDesc('createdAt')->limit(50)->get()->map(fn ($row) => [
                'id' => $row->id, 'type' => 'WITHDRAWAL', 'label' => 'Withdrawal request',
                'amount' => CryptoFunds::transactionAmount($row), 'status' => $row->status,
                'method' => $row->method, 'note' => null, 'reference' => $row->reference,
                'createdAt' => date(DATE_ATOM, strtotime($row->createdAt)),
            ]);

        return Api::ok(['items' => $items, 'nextCursor' => null]);
    }

    public function cards(Request $request): JsonResponse
    {
        $user = Guard::user($request);

        return Api::ok(DB::table('Card')->where('userId', $user->id)->orderByDesc('isDefault')->orderByDesc('createdAt')->get());
    }

    public function cardAction(Request $request, string $id): JsonResponse
    {
        $user = Guard::user($request);
        $validator = Validator::make($request->all(), ['action' => ['required', 'in:FREEZE,UNFREEZE,SET_DEFAULT']]);
        if ($validator->fails()) {
            Guard::fail('BAD_REQUEST', $validator->errors()->first(), 400);
        }
        $card = DB::transaction(function () use ($user, $id, $request) {
            $card = DB::table('Card')->where('id', $id)->where('userId', $user->id)->lockForUpdate()->first();
            if (! $card) {
                Guard::fail('NOT_FOUND', 'Card not found', 404);
            }
            $action = $request->input('action');
            if ($card->status === 'EXPIRED') {
                Guard::fail('BAD_REQUEST', 'Expired cards cannot be changed', 400);
            }
            if ($action === 'SET_DEFAULT') {
                DB::table('Card')->where('userId', $user->id)->update(['isDefault' => false]);
                DB::table('Card')->where('id', $id)->update(['isDefault' => true]);
            } else {
                DB::table('Card')->where('id', $id)->update(['status' => $action === 'FREEZE' ? 'FROZEN' : 'ACTIVE']);
            }

            return DB::table('Card')->where('id', $id)->first();
        });

        return Api::ok($card);
    }

    public function referrals(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $count = DB::table('User')->where('referredById', $user->id)->count();
        $earningsCents = (int) DB::table('ReferralEarning')->where('referrerId', $user->id)->sum('amountCents');
        $base = rtrim((string) config('qfs.public_url'), '/');

        return Api::ok([
            'code' => $user->referralCode,
            'url' => $base.'/user/user/register?ref='.rawurlencode($user->referralCode),
            'count' => $count, 'earningsCents' => $earningsCents,
            'pending' => DB::table('ReferralEarning')->where('referrerId', $user->id)->where('status', 'PENDING')->count(),
            'rateBps' => (int) (DB::table('Setting')->where('key', 'referral_rate_bps')->value('value') ?? 500),
        ]);
    }

    public function markets(Request $request): JsonResponse
    {
        Guard::user($request);
        $query = DB::table('MarketAsset')->where('isActive', true);
        if ($type = $request->query('type')) {
            $query->where('type', strtoupper($type));
        }
        $quotes = LiveQuotes::all();

        return Api::ok($query->orderBy('type')->orderBy('sort')->get()->map(function ($asset) use ($quotes) {
            $asset->live = isset($quotes[$asset->symbol]);
            if (isset($quotes[$asset->symbol])) {
                $asset->price = $quotes[$asset->symbol]['price'];
                $asset->change = $quotes[$asset->symbol]['chg'];
                $asset->direction = $quotes[$asset->symbol]['up'] ? 'up' : 'down';
            }

            return $asset;
        }));
    }

    public function documents(Request $request): JsonResponse
    {
        Guard::user($request);

        return Api::ok(DB::table('Document')->where('isActive', true)->orderBy('sort')->get());
    }

    public function reviews(Request $request): JsonResponse
    {
        Guard::user($request);

        return Api::ok(DB::table('Review')->where('status', 'APPROVED')->orderBy('sort')->limit(30)->get());
    }

    public function submitReview(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $key = 'review:'.$user->id;
        if (RateLimiter::tooManyAttempts($key, 2)) {
            Guard::fail('TOO_MANY_REQUESTS', 'Please wait before submitting another review.', 429);
        }
        $validator = Validator::make($request->all(), [
            'rating' => ['required', 'integer', 'min:1', 'max:5'],
            'text' => ['required', 'string', 'min:10', 'max:2000'],
        ]);
        if ($validator->fails()) {
            Guard::fail('BAD_REQUEST', $validator->errors()->first(), 400);
        }
        RateLimiter::hit($key, 24 * 60 * 60);
        $id = Qfs::id();
        DB::table('Review')->insert([
            'id' => $id, 'userName' => $user->name, 'avatarUrl' => $user->avatarUrl,
            'country' => $user->country, 'rating' => $request->integer('rating'),
            'text' => trim($request->input('text')), 'status' => 'PENDING',
        ]);

        return Api::ok(['submitted' => true, 'status' => 'PENDING']);
    }

    public function search(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $term = trim((string) $request->query('q', ''));
        if (mb_strlen($term) < 2) {
            return Api::ok(['items' => []]);
        }
        if (mb_strlen($term) > 80) {
            Guard::fail('BAD_REQUEST', 'Search is too long', 400);
        }
        $like = Search::pattern($term);
        $items = [];
        $labels = ['DEPOSIT' => 'Deposit', 'WITHDRAWAL' => 'Withdrawal', 'INVESTMENT' => 'Investment',
            'EARNING' => 'Earning', 'REFERRAL_BONUS' => 'Referral Bonus', 'LOAN' => 'Loan', 'ADJUSTMENT' => 'Adjustment', 'PRINCIPAL_RETURN' => 'Principal return', 'SWAP' => 'Crypto swap'];
        foreach (DB::table('Transaction')->where('userId', $user->id)
            ->where(function ($q) use ($like) {
                Search::match($q, 'reference', $like);
                Search::match($q, 'type', $like, 'or');
                Search::match($q, 'note', $like, 'or');
            })->orderByDesc('createdAt')->limit(5)->get() as $tx) {
            $items[] = ['kind' => 'Transaction', 'title' => LocalizedText::translate($labels[$tx->type] ?? $tx->type).' · '.CryptoFunds::transactionAmount($tx),
                'subtitle' => $tx->reference, 'actionModal' => 'transaction', 'targetId' => $tx->id];
        }
        foreach (DB::table('InvestmentPlan')->where('isActive', true)->where(fn ($q) => Search::match($q, 'name', $like))
            ->orderBy('sort')->limit(5)->get() as $plan) {
            $items[] = ['kind' => 'Plan', 'title' => $plan->name,
                'subtitle' => LocalizedText::translate('{rate}% monthly', ['rate' => Qfs::number($plan->monthlyRoiBps / 100, 2)]),
                'actionModal' => 'invest', 'targetId' => $plan->id];
        }
        foreach (DB::table('MarketAsset')->where('isActive', true)
            ->where(function ($q) use ($like) {
                Search::match($q, 'symbol', $like);
                Search::match($q, 'name', $like, 'or');
            })
            ->orderBy('sort')->limit(5)->get() as $asset) {
            $items[] = ['kind' => 'Market', 'title' => $asset->name,
                'subtitle' => $asset->symbol, 'actionModal' => 'market:'.strtolower($asset->type)];
        }

        return Api::ok(['items' => $items]);
    }
}
