<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

final class InvestmentLifecycle
{
    private static function isDue(object $investment): bool
    {
        return $investment->termMonths > 0 && CarbonImmutable::now('UTC')->greaterThanOrEqualTo(
            CarbonImmutable::parse($investment->startDate, 'UTC')->addMonthsNoOverflow($investment->termMonths)
        );
    }

    private static function profitSettled(object $investment): bool
    {
        $monthly = (int) floor($investment->amountCents * $investment->monthlyRoiBps / 10000 + 0.5);

        return $investment->paidOutCents >= $monthly * $investment->termMonths;
    }

    public static function mature(string $userId, string $id): bool
    {
        return DB::transaction(function () use ($userId, $id) {
            $account = DB::table('Account')->where('userId', $userId)->lockForUpdate()->first();
            $investment = DB::table('Investment')->where('id', $id)->where('userId', $userId)->lockForUpdate()->first();
            if (! $account || ! $investment || $investment->status !== 'ACTIVE' || ! self::isDue($investment) || ! self::profitSettled($investment)) {
                return false;
            }
            $end = CarbonImmutable::parse($investment->startDate, 'UTC')->addMonthsNoOverflow($investment->termMonths)->toDateTimeString();
            DB::table('Investment')->where('id', $id)->update(['status' => 'MATURED', 'maturedAt' => $end]);
            $investment->status = 'MATURED';
            AdminLog::notify($userId, 'Investment term completed', $investment->principalRelease === 'AUTOMATIC'
                ? 'All scheduled profit is paid. Your principal is being returned to available balance.'
                : 'All scheduled profit is paid. Your principal is awaiting admin release.');
            if ($investment->principalRelease === 'AUTOMATIC') {
                self::returnPrincipal($account, $investment);
            }

            return true;
        });
    }

    public static function release(string $id, string $adminId): array
    {
        return DB::transaction(function () use ($id, $adminId) {
            $owner = DB::table('Investment')->where('id', $id)->value('userId');
            if (! $owner) {
                Guard::fail('NOT_FOUND', 'Investment not found.', 404);
            }
            $account = DB::table('Account')->where('userId', $owner)->lockForUpdate()->first();
            $investment = DB::table('Investment')->where('id', $id)->lockForUpdate()->first();
            if (! $account || ! $investment) {
                Guard::fail('NOT_FOUND', 'Investment account not found.', 404);
            }
            if ($investment->status === 'CLOSED' && $investment->principalReturnedAt) {
                return ['investment' => $investment, 'released' => false];
            }
            if ($investment->status !== 'MATURED' || $investment->principalReturnedAt || ! self::isDue($investment) || ! self::profitSettled($investment)) {
                Guard::fail('CONFLICT', 'Principal can only be released after maturity and final profit settlement.', 409);
            }
            self::returnPrincipal($account, $investment);
            AdminLog::audit($adminId, 'INVESTMENT.PRINCIPAL_RELEASE', 'Investment', $id, ['amountCents' => $investment->amountCents]);

            return ['investment' => DB::table('Investment')->where('id', $id)->first(), 'released' => true];
        });
    }

    private static function returnPrincipal(object $account, object $investment): void
    {
        $reference = 'PRINCIPAL-'.$investment->id;
        if (DB::table('Transaction')->where('reference', $reference)->exists()) {
            Guard::fail('CONFLICT', 'A principal return already exists. Review the investment ledger.', 409);
        }
        $available = $account->availableCents + $investment->amountCents;
        if ($investment->amountCents <= 0 || $available > $account->balanceCents || $available > 2147483647) {
            Guard::fail('CONFLICT', 'Account balances need reconciliation before principal can be released.', 409);
        }
        $now = Qfs::now();
        $txId = Qfs::id();
        $note = 'Investment principal returned to available balance';
        DB::table('Transaction')->insert([
            'id' => $txId, 'userId' => $investment->userId, 'type' => 'PRINCIPAL_RETURN',
            'amountCents' => $investment->amountCents, 'reference' => $reference,
            'status' => 'COMPLETED', 'completedAt' => $now, 'note' => $note,
            'meta' => json_encode(['investmentId' => $investment->id, 'availableBeforeCents' => $account->availableCents,
                'availableAfterCents' => $available, 'balanceCents' => $account->balanceCents]),
        ]);
        DB::table('Account')->where('id', $account->id)->update(['availableCents' => $available, 'updatedAt' => $now]);
        DB::table('LedgerEntry')->insert([
            'id' => Qfs::id(), 'accountId' => $account->id, 'movement' => 'CREDIT',
            'amountCents' => $investment->amountCents, 'balanceAfterCents' => $account->balanceCents,
            'txId' => $txId, 'note' => $note,
        ]);
        DB::table('Investment')->where('id', $investment->id)->update(['status' => 'CLOSED', 'principalReturnedAt' => $now]);
        AdminLog::notify($investment->userId, 'Investment principal released', '{amount, number, ::currency/USD} is now available in your account.', ['amount' => $investment->amountCents / 100]);
    }
}
