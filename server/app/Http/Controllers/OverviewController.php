<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\CryptoFunds;
use App\Support\Earnings;
use App\Support\Guard;
use App\Support\LiveQuotes;
use App\Support\LocalizedText;
use App\Support\PlanMaterials;
use App\Support\Qfs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class OverviewController
{
    private function date(?string $value, string $format = 'M j, Y, h:i A'): string
    {
        if (! $value) {
            return '';
        }
        if (app()->getLocale() === 'en') {
            return date($format, strtotime($value));
        }
        $formatter = new \IntlDateFormatter(app()->getLocale(), \IntlDateFormatter::NONE, \IntlDateFormatter::NONE, 'UTC', \IntlDateFormatter::GREGORIAN,
            $format === 'F Y' ? 'MMMM y' : 'MMM d, y, h:mm a');

        return $formatter->format(strtotime($value)) ?: date($format, strtotime($value));
    }

    private function payout(): array
    {
        $settings = DB::table('Setting')->pluck('value', 'key');
        $get = fn ($key) => trim((string) ($settings[$key] ?? ''));
        $methods = [];
        if ($get('deposit_bank_account') !== '') {
            $items = array_values(array_filter([
                ['label' => 'Bank', 'value' => $get('deposit_bank_name')],
                ['label' => 'Account number', 'value' => $get('deposit_bank_account')],
                ['label' => 'Account name', 'value' => $get('deposit_bank_account_name')],
            ], fn ($item) => $item['value'] !== ''));
            $methods[] = ['method' => 'Bank Transfer', 'items' => $items];
        }
        foreach ([
            ['Bitcoin', 'deposit_btc_address', 'BTC receiving address'],
            ['Ethereum', 'deposit_eth_address', 'ETH receiving address'],
            ['USDT (TRC20)', 'deposit_usdt_trc20', 'USDT (TRC20) receiving address'],
            ['USDT (BEP20)', 'deposit_usdt_bep20', 'USDT (BEP20) receiving address'],
        ] as [$method, $key, $label]) {
            if ($get($key) !== '') {
                $methods[] = ['method' => $method, 'items' => [['label' => $label, 'value' => $get($key)]]];
            }
        }

        return $methods;
    }

    private function card(string $key, string $label, string $amount, string $sub, string $trend,
        string $trendDir, string $action, string $tone, string $actionModal): array
    {
        return [
            ...compact('key', 'amount', 'trendDir', 'tone', 'actionModal'),
            'label' => LocalizedText::translate($label), 'sub' => LocalizedText::translate($sub),
            'trend' => LocalizedText::translate($trend), 'action' => LocalizedText::translate($action),
        ];
    }

    public function show(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $id = $user->id;
        Earnings::forUser($id);
        $account = DB::table('Account')->where('userId', $id)->first();
        if (! $account) {
            Guard::fail('NOT_FOUND', 'Account not found', 404);
        }
        $investments = DB::table('Investment')->join('InvestmentPlan', 'Investment.planId', '=', 'InvestmentPlan.id')
            ->where('Investment.userId', $id)->where('Investment.status', 'ACTIVE')
            ->orderByDesc('Investment.createdAt')
            ->select('Investment.*', 'InvestmentPlan.name as planName')->get();
        $transactions = DB::table('Transaction')->where('userId', $id)->orderByDesc('createdAt')->limit(10)->get();
        $plans = DB::table('InvestmentPlan')->where('isActive', true)->orderBy('sort')->get();
        $markets = DB::table('MarketAsset')->where('isActive', true)->orderBy('sort')->get();
        $documents = DB::table('Document')->where('isActive', true)->orderBy('sort')->get();
        $reviews = DB::table('Review')->where('status', 'APPROVED')->orderBy('sort')->limit(20)->get();
        $cards = DB::table('Card')->where('userId', $id)->orderByDesc('createdAt')->get();
        $notifications = DB::table('Notification')->where('userId', $id)->orderByDesc('createdAt')->limit(6)->get();
        $loans = DB::table('Loan')->where('userId', $id)->whereIn('status', ['ACTIVE', 'PENDING'])->get();
        $earnings = DB::table('Transaction')->where('userId', $id)->whereIn('type', ['EARNING', 'REFERRAL_BONUS'])
            ->where('status', 'COMPLETED')->get();
        $withdrawals = DB::table('Transaction')->where('userId', $id)->where('type', 'WITHDRAWAL')
            ->where('status', 'COMPLETED')->orderByDesc('createdAt')->get();
        $monthStart = now()->startOfMonth();
        $depositsMonth = (int) DB::table('Transaction')->where('userId', $id)->where('type', 'DEPOSIT')
            ->where('status', 'COMPLETED')->where('createdAt', '>=', $monthStart)->sum('amountCents');
        $activeCents = (int) $investments->sum('amountCents');
        $earningsCents = (int) $earnings->sum('amountCents');
        $investmentEarningsCents = (int) $earnings->where('type', 'EARNING')->sum('amountCents');
        $earningsMonth = (int) $earnings->filter(fn ($e) => strtotime($e->createdAt) >= $monthStart->timestamp)->sum('amountCents');
        $withdrawalsCents = (int) $withdrawals->sum('amountCents');
        $loanCents = (int) $loans->where('status', 'ACTIVE')->sum('amountCents');
        $topPlan = $investments->first();
        $lastWithdrawal = $withdrawals->first();
        $referralCount = DB::table('User')->where('referredById', $id)->count();
        $referralCents = (int) DB::table('ReferralEarning')->where('referrerId', $id)->sum('amountCents');
        $unread = DB::table('Notification')->where('userId', $id)->whereNull('readAt')->count();
        $quotes = LiveQuotes::all();
        $accrual = Earnings::pendingForUser($id);
        $marketItems = $markets->map(fn ($m) => [
            'sym' => $m->symbol, 'name' => $m->name, 'full' => $m->full,
            'price' => $quotes[$m->symbol]['price'] ?? $m->price,
            'chg' => $quotes[$m->symbol]['chg'] ?? $m->change,
            'up' => $quotes[$m->symbol]['up'] ?? ($m->direction === 'up'), 'color' => $m->color,
            'live' => isset($quotes[$m->symbol]),
            'type' => $m->type,
        ]);
        $byType = fn ($type) => $marketItems->where('type', $type)->map(function ($m) {
            unset($m['type']);

            return $m;
        })->values()->all();
        $labels = ['DEPOSIT' => 'Deposit', 'WITHDRAWAL' => 'Withdrawal', 'INVESTMENT' => 'Investment',
            'EARNING' => 'Earning', 'REFERRAL_BONUS' => 'Referral Bonus', 'LOAN' => 'Loan', 'ADJUSTMENT' => 'Adjustment', 'PRINCIPAL_RETURN' => 'Principal return', 'SWAP' => 'Crypto swap'];
        $kinds = ['DEPOSIT' => 'dep', 'WITHDRAWAL' => 'wd', 'INVESTMENT' => 'inv', 'REFERRAL_BONUS' => 'ref', 'SWAP' => 'swap'];
        $recent = $transactions->map(function ($t) use ($labels, $kinds) {
            $out = in_array($t->type, ['WITHDRAWAL', 'INVESTMENT'], true);

            return [
                'id' => $t->id, 'kind' => $kinds[$t->type] ?? 'earn',
                'title' => LocalizedText::translate($labels[$t->type] ?? $t->type),
                'meta' => $t->method && $t->type !== 'INVESTMENT' ? $t->method.' · '.$t->reference : ($t->note ?: $t->reference),
                'amount' => ($t->type === 'SWAP' ? '' : ($out ? '-' : '+')).CryptoFunds::transactionAmount($t), 'cls' => $t->type === 'SWAP' ? 'neutral' : ($out ? 'minus' : 'plus'),
                'date' => $this->date($t->createdAt),
                'status' => $t->status === 'COMPLETED' ? 'Completed'
                    : ($t->status === 'PENDING' ? 'Pending' : ($t->status === 'CANCELLED' ? 'Cancelled' : 'Failed')),
            ];
        })->all();
        $base = rtrim((string) config('qfs.public_url'), '/');
        $data = [
            'kyc' => KycController::summary($id, $user->kycLevel),
            'user' => [
                'name' => $user->name, 'email' => $user->email, 'role' => $user->role,
                'avatarUrl' => $user->avatarUrl, 'country' => $user->country,
                'referralCode' => $user->referralCode,
                'memberSince' => LocalizedText::translate('Member since {date}', ['date' => $this->date($user->memberSince, 'F Y')]),
                'kycLevel' => $user->kycLevel,
            ],
            'balance' => [
                'totalCents' => $account->balanceCents, 'availableCents' => $account->availableCents,
                'total' => Qfs::money($account->balanceCents), 'available' => Qfs::money($account->availableCents),
                'thisMonthDeposits' => Qfs::money($depositsMonth),
            ],
            'investmentSummary' => [
                'activeCount' => $investments->count(), 'activeAmount' => Qfs::money($activeCents),
                'activeTrend' => $topPlan ? $topPlan->planName.' +'.Qfs::money((int) floor(($topPlan->amountCents * $topPlan->monthlyRoiBps / 10000) + 0.5)).'/mo' : 'Start investing today',
            ],
            'earnings' => ['total' => Qfs::money($earningsCents), 'thisMonth' => Qfs::money($earningsMonth), 'count' => $earnings->count()],
            'accrual' => $accrual,
            'withdrawals' => ['total' => Qfs::money($withdrawalsCents), 'count' => $withdrawals->count()],
            'loans' => ['total' => Qfs::money($loanCents), 'count' => $loans->count()],
            'balanceCards' => [
                $this->card('balance', 'Total Balance', Qfs::money($account->balanceCents), LocalizedText::translate('Available: {amount}', ['amount' => Qfs::money($account->availableCents)]),
                    LocalizedText::translate('+{amount} this month', ['amount' => Qfs::money($depositsMonth)]), 'up', 'Add Fund', 'lime', 'deposit'),
                $this->card('investments', 'Active Investments', Qfs::money($activeCents), LocalizedText::translate('{count, plural, one {# active plan} other {# active plans}}', ['count' => $investments->count()]),
                    $topPlan ? LocalizedText::translate('{plan} +{rate}% monthly', ['plan' => $topPlan->planName, 'rate' => Qfs::number($topPlan->monthlyRoiBps / 100, 2)]) : 'Start investing today',
                    'up', 'View Investments', 'ghost', 'investments'),
                $this->card('earnings', 'Investment Profit', Qfs::money($investmentEarningsCents), 'Paid to balance',
                    LocalizedText::translate('{amount} pending payout', ['amount' => $accrual['pending']]), 'up', 'View History', 'ghost', 'history'),
                $this->card('withdrawals', 'Total Withdrawals', Qfs::money($withdrawalsCents), LocalizedText::translate('{count, plural, one {# withdrawal} other {# withdrawals}}', ['count' => $withdrawals->count()]),
                    $lastWithdrawal ? LocalizedText::translate('Last: {date}', ['date' => $this->date($lastWithdrawal->createdAt)]) : 'No withdrawals yet',
                    'down', 'Withdraw', 'ghost', 'withdraw'),
                $this->card('loans', 'Active Loans', Qfs::money($loanCents), $loanCents > 0 ? 'Active balance' : 'No active loans',
                    $loans->where('status', 'PENDING')->count() > 0 ? 'Application under review' : 'View applications', 'flat',
                    'View Loans', 'ghost', 'loans'),
            ],
            'recentTx' => $recent,
            'markets' => ['metals' => $byType('METAL'), 'stocks' => $byType('STOCK'), 'crypto' => $byType('CRYPTO')],
            'documents' => $documents->map(fn ($d) => ['code' => $d->code, 'label' => $d->title,
                'flag' => $d->flagPath, 'fileUrl' => $d->fileUrl])->all(),
            'illustrativeReviews' => (bool) config('qfs.illustrative_reviews', false),
            'reviews' => $reviews->map(fn ($r) => [
                'name' => $r->userName, 'meta' => ($r->country ? $r->country.' · ' : '').LocalizedText::translate('Verified Investor'),
                'avatar' => $r->avatarUrl ?: '/avatars/avatar1.jpg', 'stars' => $r->rating, 'text' => $r->text,
            ])->all(),
            'cards' => $cards->map(fn ($c) => [
                'id' => $c->id, 'brand' => $c->brand, 'last4' => $c->last4, 'expiry' => $c->expiry,
                'holder' => $c->holder, 'color' => $c->color, 'status' => $c->status,
            ])->all(),
            'plans' => $plans->map(fn ($p) => [
                'id' => $p->id, 'name' => $p->name, 'min' => Qfs::money($p->minAmountCents),
                'max' => $p->maxAmountCents ? Qfs::money($p->maxAmountCents) : null,
                'roi' => LocalizedText::translate('{rate}% monthly', ['rate' => Qfs::number($p->monthlyRoiBps / 100, 2)]),
                'term' => LocalizedText::translate('{count, plural, one {# month} other {# months}}', ['count' => $p->termMonths]),
                'payoutInterval' => $p->payoutInterval,
                'principalRelease' => $p->principalRelease,
                ...PlanMaterials::localize(PlanMaterials::forPlan($p)),
            ])->all(),
            'referral' => ['url' => ($base ?: '').'/user/user/register?ref='.rawurlencode($user->referralCode),
                'count' => $referralCount, 'earnings' => Qfs::money($referralCents),
                'pending' => DB::table('ReferralEarning')->where('referrerId', $id)->where('status', 'PENDING')->count(),
                'rateBps' => (int) (DB::table('Setting')->where('key', 'referral_rate_bps')->value('value') ?? 500)],
            'notifications' => ['unread' => $unread, 'items' => $notifications->map(fn ($n) => [
                'id' => $n->id, ...LocalizedText::notification($n), 'read' => $n->readAt !== null,
                'time' => $this->date($n->createdAt),
            ])->all()],
            'payout' => $this->payout(),
        ];

        return Api::ok($data);
    }
}
