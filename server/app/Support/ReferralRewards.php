<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

final class ReferralRewards
{
    /** Caller holds the deposit and both account locks inside the approval transaction. */
    public static function approvedDeposit(object $deposit): void
    {
        $owner = DB::table('User')->where('id', $deposit->userId)->first();
        $referrerId = $owner?->referredById;
        $rate = (int) (DB::table('Setting')->where('key', 'referral_rate_bps')->value('value') ?? 500);
        if (! $referrerId || $referrerId === $deposit->userId || $rate <= 0 || $rate > 10000) {
            return;
        }
        if (DB::table('ReferralEarning')->where('depositRequestId', $deposit->id)->exists()) {
            return;
        }
        $id = Qfs::id();
        DB::table('ReferralEarning')->insert([
            'id' => $id, 'referrerId' => $referrerId, 'referredUserId' => $deposit->userId,
            'depositRequestId' => $deposit->id, 'investmentId' => null,
            'amountCents' => 0, 'rateBps' => $rate, 'status' => 'PENDING',
            'baseAmountCents' => empty($deposit->assetKey) ? $deposit->amountCents : null,
        ]);
        self::settle($id, empty($deposit->assetKey) ? [] : CryptoPrices::all());
    }

    public static function settle(string $id, array $prices): bool
    {
        return DB::transaction(function () use ($id, $prices) {
            $recipient = DB::table('ReferralEarning')->where('id', $id)->value('referrerId');
            $account = DB::table('Account')->where('userId', $recipient)->lockForUpdate()->first();
            $reward = DB::table('ReferralEarning')->where('id', $id)->lockForUpdate()->first();
            if (! $reward || $reward->status !== 'PENDING' || ! $reward->depositRequestId) {
                return false;
            }
            $deposit = DB::table('DepositRequest')->where('id', $reward->depositRequestId)->first();
            if (! $deposit || $deposit->status !== 'APPROVED') {
                return false;
            }
            $base = $reward->baseAmountCents;
            if ($base === null) {
                $price = $prices[$deposit->assetKey] ?? null;
                if (! $price || abs(now()->timestamp - $price['timestamp']) > 120) {
                    return false;
                }
                try {
                    $base = CryptoAssets::usd($deposit->assetKey, $deposit->quantityAtomic, $price['rate']);
                    if ($base < 0 || $base > 2147483647) {
                        return false;
                    }
                } catch (\Throwable) {
                    return false;
                }
                DB::table('ReferralEarning')->where('id', $id)->update([
                    'baseAmountCents' => $base,
                    'valuation' => json_encode(['assetKey' => $deposit->assetKey, 'quantityAtomic' => $deposit->quantityAtomic,
                        'rateUsd' => $price['rate'], 'priceAt' => gmdate(DATE_ATOM, $price['timestamp'])]),
                ]);
            }
            $bonus = intdiv((int) $base * (int) $reward->rateBps, 10000);
            if ($bonus === 0) {
                DB::table('ReferralEarning')->where('id', $id)->update(['status' => 'BELOW_MINIMUM']);

                return true;
            }
            if (! $account || DB::table('User')->where('id', $recipient)->value('status') !== 'ACTIVE'
                || $account->balanceCents + $bonus > 2147483647 || $account->availableCents + $bonus > 2147483647) {
                return false;
            }
            $txId = Qfs::id();
            $name = DB::table('User')->where('id', $deposit->userId)->value('name');
            DB::table('Transaction')->insert([
                'id' => $txId, 'userId' => $recipient, 'type' => 'REFERRAL_BONUS',
                'amountCents' => $bonus, 'reference' => 'TX-REF-DEP-'.$deposit->id,
                'status' => 'COMPLETED', 'completedAt' => Qfs::now(),
                'note' => 'Referral bonus — '.$name,
                'meta' => json_encode(['depositRequestId' => $deposit->id, 'referredUserId' => $deposit->userId,
                    'baseAmountCents' => (int) $base, 'rateBps' => (int) $reward->rateBps]),
            ]);
            DB::table('Account')->where('id', $account->id)->update([
                'balanceCents' => $account->balanceCents + $bonus, 'availableCents' => $account->availableCents + $bonus,
                'updatedAt' => Qfs::now(),
            ]);
            DB::table('LedgerEntry')->insert([
                'id' => Qfs::id(), 'accountId' => $account->id, 'movement' => 'CREDIT',
                'amountCents' => $bonus, 'balanceAfterCents' => $account->balanceCents + $bonus,
                'txId' => $txId, 'note' => 'Referral bonus — '.$name,
            ]);
            DB::table('ReferralEarning')->where('id', $id)->update(['amountCents' => $bonus, 'status' => 'PAID']);
            AdminLog::notify($recipient, 'Referral bonus earned',
                'You earned a {amount, number, ::currency/USD} referral bonus from {name}.', ['amount' => $bonus / 100, 'name' => $name]);

            return true;
        });
    }

    public static function sweep(): int
    {
        $ids = DB::table('ReferralEarning')->where('status', 'PENDING')->whereNotNull('depositRequestId')
            ->orderBy('createdAt')->limit(200)->pluck('id');
        if ($ids->isEmpty()) {
            return 0;
        }
        $prices = CryptoPrices::all();
        $paid = 0;
        foreach ($ids as $id) {
            if (self::settle($id, $prices)) {
                $paid++;
            }
        }

        return $paid;
    }
}
