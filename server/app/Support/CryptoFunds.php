<?php

namespace App\Support;

use Brick\Math\BigInteger;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

final class CryptoFunds
{
    /** Caller holds the user's Account lock before changing a crypto balance. */
    public static function balance(string $userId, string $key): object
    {
        DB::table('CryptoBalance')->insertOrIgnore(['id' => Qfs::id(), 'userId' => $userId, 'assetKey' => $key]);

        return DB::table('CryptoBalance')->where('userId', $userId)->where('assetKey', $key)->lockForUpdate()->first();
    }

    public static function move(object $balance, string $totalDelta, string $reserveDelta, string $kind, string $quantity, string $reference): void
    {
        $total = BigInteger::of($balance->totalAtomic)->plus($totalDelta);
        $reserved = BigInteger::of($balance->reservedAtomic)->plus($reserveDelta);
        if ($total->isNegative() || $reserved->isNegative() || $reserved->isGreaterThan($total) || strlen((string) $total) > 78) {
            Guard::fail('INSUFFICIENT_FUNDS', 'Insufficient available crypto balance.', 400);
        }
        DB::table('CryptoBalance')->where('id', $balance->id)->update([
            'totalAtomic' => (string) $total, 'reservedAtomic' => (string) $reserved, 'updatedAt' => Qfs::now(),
        ]);
        DB::table('CryptoLedger')->insert([
            'id' => Qfs::id(), 'userId' => $balance->userId, 'assetKey' => $balance->assetKey,
            'reference' => $reference, 'kind' => $kind, 'quantityAtomic' => $quantity,
            'totalAfterAtomic' => (string) $total, 'reservedAfterAtomic' => (string) $reserved,
        ]);
    }

    public static function quote(string $userId, string $id, string $purpose): object
    {
        $quote = DB::table('CryptoQuote')->where('id', $id)->where('userId', $userId)->lockForUpdate()->first();
        if (! $quote || $quote->purpose !== $purpose || $quote->usedAt || now()->greaterThanOrEqualTo($quote->expiresAt)) {
            Guard::fail('QUOTE_EXPIRED', 'This quote is unavailable or expired. Request a new quote.', 409);
        }

        return $quote;
    }

    /** Converts only the committed crypto into a USD investment reservation. */
    public static function fundInvestment(object $account, string $quoteId, int $amountCents, string $reference): array
    {
        $quote = self::quote($account->userId, $quoteId, 'INVESTMENT');
        if ($quote->amountCents !== $amountCents) {
            Guard::fail('QUOTE_MISMATCH', 'The investment amount differs from the confirmed quote.', 400);
        }
        $balance = self::balance($account->userId, $quote->assetKey);
        self::move($balance, '-'.$quote->quantityAtomic, '0', 'INVESTMENT', $quote->quantityAtomic, 'INV-'.$reference);
        $newTotal = $account->balanceCents + $amountCents;
        $newAvailable = $account->availableCents + $amountCents;
        if ($newTotal > 2147483647 || $newAvailable > 2147483647) {
            Guard::fail('BALANCE_LIMIT', 'Account balance limit exceeded', 400);
        }
        DB::table('Account')->where('id', $account->id)->update(['balanceCents' => $newTotal, 'availableCents' => $newAvailable, 'updatedAt' => Qfs::now()]);
        DB::table('CryptoQuote')->where('id', $quote->id)->update(['usedAt' => Qfs::now()]);
        DB::table('LedgerEntry')->insert([
            'id' => Qfs::id(), 'accountId' => $account->id, 'movement' => 'CREDIT',
            'amountCents' => $amountCents, 'balanceAfterCents' => $newTotal,
            'note' => 'USD investment funding from '.CryptoAssets::quantity($quote->assetKey, $quote->quantityAtomic).' '.CryptoAssets::get($quote->assetKey)['symbol'].' ('.$reference.')',
        ]);
        $account->balanceCents = $newTotal;
        $account->availableCents = $newAvailable;

        return ['assetKey' => $quote->assetKey, 'symbol' => CryptoAssets::get($quote->assetKey)['symbol'], 'network' => CryptoAssets::get($quote->assetKey)['network'], 'quantity' => CryptoAssets::quantity($quote->assetKey, $quote->quantityAtomic),
            'quantityAtomic' => $quote->quantityAtomic, 'rateUsd' => $quote->rateUsd,
            'priceAt' => $quote->priceAt, 'lockedAt' => Qfs::now(), 'amountCents' => $amountCents, 'quoteId' => $quote->id];
    }

    public static function requestInfo(object $row): array
    {
        if (empty($row->assetKey)) {
            return [];
        }
        $asset = CryptoAssets::get($row->assetKey);

        return [
            'assetKey' => $row->assetKey, 'symbol' => $asset['symbol'], 'network' => $asset['network'],
            'quantity' => CryptoAssets::quantity($row->assetKey, $row->quantityAtomic),
            'quantityAtomic' => $row->quantityAtomic, 'fundingSource' => $row->fundingSource,
            'receivingAddress' => $row->receivingAddress, 'txHash' => $row->txHash,
            'destinationTag' => $row->destinationTag ?? null,
            'explorerUrl' => $row->txHash ? $asset['explorer'].$row->txHash : null,
        ];
    }

    public static function transactionAmount(object $row): string
    {
        if (($row->type ?? null) === 'SWAP') {
            $meta = json_decode($row->meta ?? '{}', true);

            return CryptoAssets::quantity($row->assetKey, $row->quantityAtomic).' '.CryptoAssets::get($row->assetKey)['symbol'].' → '
                .CryptoAssets::quantity($meta['toAsset'], $meta['receivedAtomic']).' '.CryptoAssets::get($meta['toAsset'])['symbol'];
        }

        return ! empty($row->assetKey) && isset($row->quantityAtomic)
            ? CryptoAssets::quantity($row->assetKey, $row->quantityAtomic).' '.CryptoAssets::get($row->assetKey)['symbol']
            : Qfs::money($row->amountCents);
    }

    public static function summary(string $userId): array
    {
        $account = DB::table('Account')->where('userId', $userId)->first();
        $prices = CryptoPrices::all();
        $balances = DB::table('CryptoBalance')->where('userId', $userId)->get()->keyBy('assetKey');
        $wallets = DB::table('ReceivingWallet')->where('isActive', true)->orderBy('createdAt')->get();
        $total = (int) $account->balanceCents;
        $available = (int) $account->availableCents;
        $complete = true;
        $holdings = [];
        foreach (CryptoAssets::ALL as $key => $asset) {
            $row = $balances->get($key);
            $units = $row->totalAtomic ?? '0';
            $reserved = $row->reservedAtomic ?? '0';
            $free = (string) BigInteger::of($units)->minus($reserved);
            $price = $prices[$key] ?? null;
            $usd = $freeUsd = null;
            if ($units === '0') {
                $usd = $freeUsd = 0;
            } elseif ($price) {
                try {
                    $usd = CryptoAssets::usd($key, $units, $price['rate']);
                    $freeUsd = CryptoAssets::usd($key, $free, $price['rate']);
                } catch (\Throwable) {
                    $usd = $freeUsd = null;
                }
            }
            if ($usd === null) {
                $complete = false;
            } else {
                $total += $usd;
                $available += $freeUsd;
            }
            $holdings[] = ['assetKey' => $key, ...$asset,
                'quantity' => CryptoAssets::quantity($key, $units), 'available' => CryptoAssets::quantity($key, $free),
                'reserved' => CryptoAssets::quantity($key, $reserved), 'availableAtomic' => $free,
                'usd' => $usd === null ? null : Qfs::money($usd), 'availableUsd' => $freeUsd === null ? null : Qfs::money($freeUsd),
                'priceUsd' => $price['rate'] ?? null, 'priceAt' => $price ? gmdate(DATE_ATOM, $price['timestamp']) : null,
            ];
        }
        $requests = [];
        foreach (['DepositRequest' => 'DEPOSIT', 'WithdrawalRequest' => 'WITHDRAWAL'] as $table => $type) {
            foreach (DB::table($table)->where('userId', $userId)->whereNotNull('assetKey')->orderByDesc('createdAt')->limit(15)->get() as $row) {
                $requests[] = ['id' => $row->id, 'type' => $type, 'reference' => $row->reference, 'status' => $row->status,
                    'createdAt' => $row->createdAt, 'adminNote' => $row->adminNote, ...self::requestInfo($row)];
            }
        }
        usort($requests, fn ($a, $b) => strcmp($b['createdAt'], $a['createdAt']));

        return [
            'usd' => ['available' => Qfs::money($account->availableCents), 'availableCents' => $account->availableCents, 'total' => Qfs::money($account->balanceCents)],
            'totalUsd' => $complete ? Qfs::money($total) : null, 'availableUsd' => $complete ? Qfs::money($available) : null,
            'valuationComplete' => $complete, 'holdings' => $holdings, 'wallets' => $wallets, 'requests' => array_slice($requests, 0, 20),
        ];
    }

    /** Keep receipt claims even when an admin later corrects or clears the displayed hash. */
    public static function claimDepositTransfer(object $item, string $hash): array
    {
        $key = CryptoAssets::txKey($item->assetKey, $hash);
        $reference = 'DEP-'.$item->id;
        $claimReference = $reference.':'.hash('sha256', $key);
        $claim = DB::table('CryptoTransferClaim')->where('chainTxKey', $key)->first();
        if (DB::table('DepositRequest')->where('chainTxKey', $key)->where('id', '!=', $item->id)->exists()
            || ($claim && $claim->reference !== $reference && $claim->reference !== $claimReference)) {
            Guard::fail('DUPLICATE_TRANSFER', 'This transaction was already submitted.', 409);
        }
        if (! $claim) {
            try {
                DB::table('CryptoTransferClaim')->insert(['chainTxKey' => $key, 'reference' => $claimReference]);
            } catch (QueryException $error) {
                if ($error instanceof UniqueConstraintViolationException) {
                    Guard::fail('DUPLICATE_TRANSFER', 'This transaction was already submitted.', 409);
                }
                throw $error;
            }
        }

        return ['chainTxKey' => $key, 'txHash' => CryptoAssets::hash($item->assetKey, $hash)];
    }

    /** Approval is the admin's independent confirmation; a transfer hash is optional. */
    public static function review(object $admin, object $item, string $type, string $status, string $note, ?string $txHash): void
    {
        $account = DB::table('Account')->where('userId', $item->userId)->lockForUpdate()->first();
        if (! $account) {
            Guard::fail('NOT_FOUND', 'Account not found', 404);
        }
        $table = $type === 'DEPOSIT' ? 'DepositRequest' : 'WithdrawalRequest';
        $hash = $item->txHash;
        $chainTxKey = $item->chainTxKey;
        if ($status === 'APPROVED') {
            $hash = trim($txHash ?? '');
            $hash = $hash === '' ? null : $hash;
            $chainTxKey = null;
            if ($hash !== null) {
                if ($type === 'DEPOSIT') {
                    $transfer = self::claimDepositTransfer($item, $hash);
                    $hash = $transfer['txHash'];
                    $chainTxKey = $transfer['chainTxKey'];
                } else {
                    $chainTxKey = CryptoAssets::txKey($item->assetKey, $hash);
                    $hash = CryptoAssets::hash($item->assetKey, $hash);
                    if (DB::table('WithdrawalRequest')->where('chainTxKey', $chainTxKey)->where('id', '!=', $item->id)->exists()) {
                        Guard::fail('DUPLICATE_TRANSFER', 'This payout transaction was already used.', 409);
                    }
                }
            }
        }
        $usd = $item->fundingSource === 'USD';
        if ($type === 'DEPOSIT' && $status === 'APPROVED') {
            $balance = self::balance($item->userId, $item->assetKey);
            self::move($balance, $item->quantityAtomic, '0', 'DEPOSIT', $item->quantityAtomic, 'DEP-'.$item->id);
        }
        if ($type === 'WITHDRAWAL') {
            if ($usd) {
                $total = $account->balanceCents - ($status === 'APPROVED' ? $item->amountCents : 0);
                $free = $account->availableCents + ($status === 'REJECTED' ? $item->amountCents : 0);
                if ($total < $free || $free > 2147483647) {
                    Guard::fail('BALANCE', 'The withdrawal reservation is inconsistent.', 409);
                }
                DB::table('Account')->where('id', $account->id)->update(['balanceCents' => $total, 'availableCents' => $free, 'updatedAt' => Qfs::now()]);
                DB::table('LedgerEntry')->insert([
                    'id' => Qfs::id(), 'accountId' => $account->id, 'movement' => $status === 'APPROVED' ? 'DEBIT' : 'CREDIT',
                    'amountCents' => $item->amountCents, 'balanceAfterCents' => $total, 'note' => 'Crypto payout '.strtolower($status).' ('.$item->reference.')',
                ]);
            } else {
                $balance = self::balance($item->userId, $item->assetKey);
                self::move($balance, $status === 'APPROVED' ? '-'.$item->quantityAtomic : '0',
                    '-'.$item->quantityAtomic, $status === 'APPROVED' ? 'WITHDRAWAL' : 'RELEASE',
                    $item->quantityAtomic, 'WD-REVIEW-'.$item->id);
            }
        }
        $txId = null;
        if ($status === 'APPROVED') {
            $txId = Qfs::id();
            DB::table('Transaction')->insert([
                'id' => $txId, 'userId' => $item->userId, 'type' => $type, 'amountCents' => $item->amountCents,
                'assetKey' => $item->assetKey, 'quantityAtomic' => $item->quantityAtomic, 'method' => $item->method,
                'reference' => 'CRYPTO-'.$type.'-'.$item->id, 'status' => 'COMPLETED', 'completedAt' => Qfs::now(),
                'note' => $note ?: ($type === 'DEPOSIT' ? 'Crypto deposit confirmed' : 'Crypto withdrawal paid'),
                'meta' => json_encode(['txHash' => $hash, 'receivingAddress' => $item->receivingAddress, 'fundingSource' => $item->fundingSource]),
            ]);
        }
        DB::table($table)->where('id', $item->id)->update([
            'status' => $status, 'reviewedById' => $admin->id, 'reviewedAt' => Qfs::now(),
            'adminNote' => $note ?: null, 'transactionId' => $txId, 'txHash' => $hash, 'chainTxKey' => $chainTxKey,
        ]);
        if ($type === 'DEPOSIT' && $status === 'APPROVED') {
            ReferralRewards::approvedDeposit($item);
        }
        AdminLog::audit($admin->id, 'CRYPTO.'.$type.'.'.$status, $table, $item->id, ['assetKey' => $item->assetKey, 'quantityAtomic' => $item->quantityAtomic, 'txHash' => $hash, 'previousTxHash' => $item->txHash]);
        $title = ucfirst(strtolower($type)).' '.strtolower($status);
        $body = $status === 'APPROVED'
            ? ($type === 'DEPOSIT' ? 'Your deposit has been approved and credited to your account.' : 'Your withdrawal has been approved and paid out.')
            : ($note ?: ($type === 'DEPOSIT' ? 'Your deposit request was rejected.' : 'Your withdrawal request was rejected and funds returned to your balance.'));
        AdminLog::notify($item->userId, $title, $body);
    }
}
