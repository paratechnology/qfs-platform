<?php

namespace App\Support;

use Brick\Math\BigInteger;
use Illuminate\Support\Facades\DB;

final class Reconciliation
{
    public static function account(string $userId): array
    {
        return DB::transaction(function () use ($userId) {
            $account = DB::table('Account')->where('userId', $userId)->lockForUpdate()->first();
            $user = DB::table('User')->where('id', $userId)->first();
            $issues = [];
            $add = function (string $code, string $asset, string $expected, string $actual) use (&$issues): void {
                $issues[] = compact('code', 'asset', 'expected', 'actual');
            };
            if ($account->availableCents < 0 || $account->balanceCents < $account->availableCents) {
                $add('USD_BALANCE_RANGE', 'USD', '0 <= available <= total', $account->availableCents.' / '.$account->balanceCents);
            }
            $capital = DB::table('Investment')->where('userId', $userId)->whereIn('status', ['ACTIVE', 'MATURED'])->whereNull('principalReturnedAt')->sum('amountCents');
            $withdrawals = DB::table('WithdrawalRequest')->where('userId', $userId)->where('status', 'PENDING');
            $usdHeld = (clone $withdrawals)->where(fn ($q) => $q->whereNull('assetKey')->orWhere('fundingSource', 'USD'))->sum('amountCents');
            $actualHeld = $account->balanceCents - $account->availableCents;
            if ($actualHeld !== (int) ($capital + $usdHeld)) {
                $add('USD_RESERVATIONS', 'USD', (string) ($capital + $usdHeld), (string) $actualHeld);
            }
            $latest = DB::table('LedgerEntry')->where('accountId', $account->id)->orderByDesc('createdAt')->orderByDesc('id')->first();
            if ($latest ? $latest->balanceAfterCents !== $account->balanceCents : $account->balanceCents !== 0) {
                $add('USD_LATEST_LEDGER', 'USD', $latest ? (string) $latest->balanceAfterCents : 'No ledger record', (string) $account->balanceCents);
            }
            $holds = [];
            foreach ((clone $withdrawals)->whereNotNull('assetKey')->where('fundingSource', 'CRYPTO')->get() as $row) {
                $holds[$row->assetKey] = (string) BigInteger::of($holds[$row->assetKey] ?? '0')->plus($row->quantityAtomic);
            }
            foreach (DB::table('CryptoSwap')->where('userId', $userId)->whereNotIn('status', ['COMPLETED', 'CANCELLED', 'REFUNDED'])->get() as $row) {
                $holds[$row->fromAsset] = (string) BigInteger::of($holds[$row->fromAsset] ?? '0')->plus($row->fromAtomic);
            }
            $balances = DB::table('CryptoBalance')->where('userId', $userId)->get()->keyBy('assetKey');
            $ledgerAssets = DB::table('CryptoLedger')->where('userId', $userId)->distinct()->pluck('assetKey')->all();
            foreach (array_unique([...array_keys($holds), ...$balances->keys()->all(), ...$ledgerAssets]) as $asset) {
                $balance = $balances->get($asset);
                $total = $balance->totalAtomic ?? '0';
                $reserved = $balance->reservedAtomic ?? '0';
                if (BigInteger::of($total)->isNegative() || BigInteger::of($reserved)->isNegative() || BigInteger::of($reserved)->isGreaterThan($total)) {
                    $add('CRYPTO_BALANCE_RANGE', $asset, '0 <= reserved <= total', $reserved.' / '.$total);
                }
                if (! BigInteger::of($reserved)->isEqualTo($holds[$asset] ?? '0')) {
                    $add('CRYPTO_RESERVATIONS', $asset, $holds[$asset] ?? '0', $reserved);
                }
                $last = DB::table('CryptoLedger')->where('userId', $userId)->where('assetKey', $asset)->orderByDesc('createdAt')->orderByDesc('id')->first();
                if ($last ? ! BigInteger::of($last->totalAfterAtomic)->isEqualTo($total) || ! BigInteger::of($last->reservedAfterAtomic)->isEqualTo($reserved) : $total !== '0' || $reserved !== '0') {
                    $add('CRYPTO_LATEST_LEDGER', $asset, $last ? $last->totalAfterAtomic.' / '.$last->reservedAfterAtomic : 'No ledger record', $total.' / '.$reserved);
                }
            }
            foreach (DB::table('CryptoSwap')->where('userId', $userId)->where('status', 'COMPLETED')->get() as $swap) {
                foreach (['SWAP-OUT-', 'SWAP-IN-'] as $prefix) {
                    if (! DB::table('CryptoLedger')->where('userId', $userId)->where('reference', $prefix.$swap->id)->exists()) {
                        $add('SWAP_LEDGER_MISSING', $swap->fromAsset, $prefix.$swap->id, 'Missing');
                    }
                }
                if (! DB::table('Transaction')->where('userId', $userId)->where('reference', 'SWAP-'.$swap->id)->where('status', 'COMPLETED')->exists()) {
                    $add('SWAP_RECEIPT_MISSING', $swap->toAsset, 'SWAP-'.$swap->id, 'Missing');
                }
            }

            return ['userId' => $userId, 'name' => $user->name, 'email' => $user->email, 'issues' => $issues];
        });
    }
}
