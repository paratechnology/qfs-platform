<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

final class Earnings
{
    private static function schedule(object $inv, CarbonImmutable $now): array
    {
        $start = CarbonImmutable::parse($inv->startDate, 'UTC');
        $term = (int) $inv->termMonths;
        $monthly = (int) floor($inv->amountCents * $inv->monthlyRoiBps / 10000 + 0.5);
        $completed = 0;
        while ($completed < $term && $now->greaterThanOrEqualTo($start->addMonthsNoOverflow($completed + 1))) {
            $completed++;
        }
        $hours = 0;
        $periodHours = 1;
        if ($completed < $term && $now->greaterThan($start)) {
            $periodStart = $start->addMonthsNoOverflow($completed);
            $periodEnd = $start->addMonthsNoOverflow($completed + 1);
            $periodHours = max(1, (int) ceil($periodStart->diffInSeconds($periodEnd) / 3600));
            $hours = min($periodHours, max(0, (int) floor($periodStart->diffInSeconds($now) / 3600)));
        }
        $accruedCurrent = $completed < $term ? $monthly * $hours / $periodHours : 0;
        $target = $monthly * $completed;
        if ($inv->payoutInterval === 'HOURLY') {
            $target += (int) floor($accruedCurrent + 0.5);
        }

        return compact('completed', 'monthly', 'hours', 'periodHours', 'accruedCurrent', 'target');
    }

    public static function pendingForUser(string $userId): array
    {
        $rows = DB::table('Investment')->join('InvestmentPlan', 'Investment.planId', '=', 'InvestmentPlan.id')
            ->where('Investment.userId', $userId)->where('Investment.status', 'ACTIVE')
            ->select('Investment.*', 'InvestmentPlan.name as planName')->get();
        $now = CarbonImmutable::now('UTC');
        $pendingCents = 0.0;
        $items = [];
        foreach ($rows as $inv) {
            $item = self::describe($inv);
            $items[] = $item;
            $s = self::schedule($inv, $now);
            $pendingCents += $inv->payoutInterval === 'HOURLY'
                ? max(0, $s['accruedCurrent'] - (int) floor($s['accruedCurrent'] + 0.5))
                : $s['accruedCurrent'];
        }

        return ['pending' => Qfs::money($pendingCents, 4), 'items' => $items];
    }

    public static function describe(object $inv): array
    {
        $now = CarbonImmutable::now('UTC');
        $s = self::schedule($inv, $now);
        $start = CarbonImmutable::parse($inv->startDate, 'UTC');
        $end = $inv->endDate ? CarbonImmutable::parse($inv->endDate, 'UTC') : $start->addMonthsNoOverflow($inv->termMonths);
        $nextPayout = $inv->status !== 'ACTIVE' || $s['completed'] >= $inv->termMonths ? null : ($inv->payoutInterval === 'HOURLY'
            ? $start->addMonthsNoOverflow($s['completed'])->addHours($s['hours'] + 1)
            : $start->addMonthsNoOverflow($s['completed'] + 1));
        $materials = ! empty($inv->materials) ? json_decode($inv->materials, true)
            : PlanMaterials::forPlan(DB::table('InvestmentPlan')->where('id', $inv->planId)->first());
        $materials = PlanMaterials::localize($materials);
        $pending = $inv->status !== 'ACTIVE' ? 0 : ($inv->payoutInterval === 'HOURLY'
            ? max(0, $s['accruedCurrent'] - (int) floor($s['accruedCurrent'] + 0.5))
            : $s['accruedCurrent']);

        return [
            'id' => $inv->id, 'plan' => $inv->planName, 'payoutInterval' => $inv->payoutInterval,
            'status' => $inv->status, 'principalRelease' => $inv->principalRelease,
            'maturedAt' => $inv->maturedAt ? CarbonImmutable::parse($inv->maturedAt, 'UTC')->toIso8601String() : null,
            'principalReturnedAt' => $inv->principalReturnedAt ? CarbonImmutable::parse($inv->principalReturnedAt, 'UTC')->toIso8601String() : null,
            'monthlyRate' => Qfs::number($inv->monthlyRoiBps / 100, 2).'%',
            'principal' => Qfs::money($inv->amountCents),
            'monthlyProfit' => Qfs::money($s['monthly']),
            'startedAt' => CarbonImmutable::parse($inv->startDate, 'UTC')->toIso8601String(),
            'endsAt' => $end->toIso8601String(),
            'pending' => Qfs::money($pending, 4),
            'paid' => Qfs::money($inv->paidOutCents),
            'termMonths' => $inv->termMonths,
            'totalExpectedProfit' => Qfs::money($s['monthly'] * $inv->termMonths),
            'funding' => json_decode($inv->funding ?? 'null', true),
            'nextPayoutAt' => $nextPayout?->toIso8601String(),
            'progressPercent' => round(min(100, max(0, $start->diffInSeconds($now, false) / max(1, $start->diffInSeconds($end)) * 100)), 2),
            ...$materials,
            'materialsSource' => ! empty($inv->materials) ? 'INVESTMENT' : 'CURRENT_PLAN',
        ];
    }

    private static function credit(string $userId, object $inv, int $amount, string $reference, string $note): int
    {
        if ($amount <= 0) {
            return 0;
        }

        return DB::transaction(function () use ($userId, $inv, $amount, $reference, $note) {
            $account = DB::table('Account')->where('userId', $userId)->lockForUpdate()->first();
            if (! $account) {
                Guard::fail('NOT_FOUND', 'Account not found', 404);
            }
            if (DB::table('Transaction')->where('reference', $reference)->exists()) {
                return 0;
            }
            $investment = DB::table('Investment')->where('id', $inv->id)->lockForUpdate()->first();
            if (! $investment || $investment->status !== 'ACTIVE') {
                return 0;
            }
            if ($inv->payoutInterval === 'HOURLY') {
                $target = self::schedule($investment, CarbonImmutable::now('UTC'))['target'];
                $amount = max(0, $target - $investment->paidOutCents);
                if ($amount === 0) {
                    return 0;
                }
            }
            $newBalance = $account->balanceCents + $amount;
            $newAvailable = $account->availableCents + $amount;
            if ($newBalance > 2147483647 || $newAvailable > 2147483647) {
                Guard::fail('BAD_REQUEST', 'Account balance limit exceeded', 400);
            }
            $txId = Qfs::id();
            DB::table('Transaction')->insert([
                'id' => $txId, 'userId' => $userId, 'type' => 'EARNING',
                'amountCents' => $amount, 'reference' => $reference,
                'status' => 'COMPLETED', 'completedAt' => Qfs::now(),
                'note' => $note, 'meta' => json_encode(['investmentId' => $inv->id]),
            ]);
            DB::table('Account')->where('id', $account->id)->update([
                'balanceCents' => $newBalance, 'availableCents' => $newAvailable, 'updatedAt' => Qfs::now(),
            ]);
            DB::table('LedgerEntry')->insert([
                'id' => Qfs::id(), 'accountId' => $account->id, 'movement' => 'CREDIT',
                'amountCents' => $amount, 'balanceAfterCents' => $newBalance,
                'txId' => $txId, 'note' => $note,
            ]);
            DB::table('Investment')->where('id', $inv->id)->increment('paidOutCents', $amount);

            return $amount;
        });
    }

    public static function forUser(string $userId): array
    {
        $rows = DB::table('Investment')->join('InvestmentPlan', 'Investment.planId', '=', 'InvestmentPlan.id')
            ->where('Investment.userId', $userId)->where('Investment.status', 'ACTIVE')
            ->select('Investment.*', 'InvestmentPlan.name as planName')->get();
        $credited = 0;
        $totalCents = 0;
        foreach ($rows as $inv) {
            $s = self::schedule($inv, CarbonImmutable::now('UTC'));
            if ($inv->payoutInterval === 'HOURLY') {
                if ($s['target'] > $inv->paidOutCents) {
                    $reference = 'EARN-'.$inv->id.'-H-'.$s['completed'].'-'.$s['hours'];
                    $added = self::credit($userId, $inv, $s['target'] - $inv->paidOutCents, $reference,
                        'ROI payout — '.$inv->planName.' (hourly)');
                    if ($added > 0) {
                        $credited++;
                        $totalCents += $added;
                    }
                }
            } else {
                for ($period = 1; $period <= $s['completed']; $period++) {
                    $reference = 'EARN-'.$inv->id.'-'.$period;
                    $added = self::credit($userId, $inv, $s['monthly'], $reference,
                        'ROI payout — '.$inv->planName.' (month '.$period.')');
                    if ($added > 0) {
                        $credited++;
                        $totalCents += $added;
                    }
                }
            }
            if ($inv->termMonths > 0 && $s['completed'] >= $inv->termMonths) {
                InvestmentLifecycle::mature($userId, $inv->id);
            }
        }

        return compact('credited', 'totalCents');
    }

    public static function sweep(): array
    {
        $ids = DB::table('Investment')->where('status', 'ACTIVE')->distinct()->pluck('userId');
        $credited = 0;
        $totalCents = 0;
        foreach ($ids as $id) {
            $result = self::forUser($id);
            $credited += $result['credited'];
            $totalCents += $result['totalCents'];
        }

        return ['usersProcessed' => $ids->count(), 'credited' => $credited, 'totalCents' => $totalCents];
    }
}
