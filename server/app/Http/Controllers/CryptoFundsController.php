<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\CryptoAssets;
use App\Support\CryptoFunds;
use App\Support\CryptoPrices;
use App\Support\Guard;
use App\Support\LocalizedText;
use App\Support\Qfs;
use Brick\Math\BigInteger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class CryptoFundsController
{
    public function show(Request $request): JsonResponse
    {
        return Api::ok(CryptoFunds::summary(Guard::user($request)->id));
    }

    public function quote(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $data = $request->validate([
            'purpose' => 'required|in:INVESTMENT,CRYPTO_WITHDRAWAL,USD_WITHDRAWAL',
            'assetKey' => 'required|string|max:30', 'amount' => 'sometimes|numeric|gt:0|max:1000000',
            'quantity' => 'sometimes|string|max:50',
        ]);
        $asset = CryptoAssets::get($data['assetKey']);
        $price = CryptoPrices::require($data['assetKey']);
        if ($data['purpose'] === 'CRYPTO_WITHDRAWAL') {
            $units = CryptoAssets::units($data['assetKey'], $data['quantity'] ?? null);
            try {
                $cents = CryptoAssets::usd($data['assetKey'], $units, $price['rate']);
            } catch (\Throwable) {
                Guard::fail('LIMIT', 'The quoted amount exceeds the transaction limit.', 400);
            }
        } else {
            $cents = Qfs::cents($data['amount'] ?? null);
            if ($cents === null) {
                Guard::fail('AMOUNT', 'Enter a valid USD amount with at most two decimal places.', 400);
            }
            $units = CryptoAssets::fromUsd($data['assetKey'], $cents, $price['rate'], $data['purpose'] === 'INVESTMENT');
        }
        if ($cents < 1 || $cents > 100_000_000) {
            Guard::fail('LIMIT', 'The quoted USD value must be between $0.01 and $1,000,000.', 400);
        }
        $account = DB::table('Account')->where('userId', $user->id)->first();
        if ($data['purpose'] === 'USD_WITHDRAWAL') {
            if (! $account || $account->availableCents < $cents) {
                Guard::fail('INSUFFICIENT_FUNDS', 'Insufficient available USD balance.', 400);
            }
        } else {
            $balance = DB::table('CryptoBalance')->where('userId', $user->id)->where('assetKey', $data['assetKey'])->first();
            if (! $balance || BigInteger::of($balance->totalAtomic)->minus($balance->reservedAtomic)->isLessThan($units)) {
                Guard::fail('INSUFFICIENT_FUNDS', 'Insufficient available crypto balance.', 400);
            }
        }
        if (in_array($data['purpose'], ['CRYPTO_WITHDRAWAL', 'USD_WITHDRAWAL'], true)) {
            $this->withdrawalLimits($user->id, $cents);
        }
        $id = Qfs::id();
        $expiry = min(now()->timestamp + 90, $price['timestamp'] + 120);
        DB::table('CryptoQuote')->insert([
            'id' => $id, 'userId' => $user->id, 'purpose' => $data['purpose'], 'assetKey' => $data['assetKey'],
            'quantityAtomic' => $units, 'amountCents' => $cents, 'rateUsd' => $price['rate'],
            'priceAt' => gmdate('Y-m-d H:i:s', $price['timestamp']), 'expiresAt' => gmdate('Y-m-d H:i:s', $expiry),
        ]);

        return Api::ok(['id' => $id, 'assetKey' => $data['assetKey'], 'symbol' => $asset['symbol'], 'network' => $asset['network'],
            'quantity' => CryptoAssets::quantity($data['assetKey'], $units), 'amountCents' => $cents,
            'amount' => Qfs::money($cents), 'rateUsd' => $price['rate'], 'expiresAt' => gmdate(DATE_ATOM, $expiry)]);
    }

    public function deposit(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $data = $request->validate(['walletId' => 'required|string|max:64', 'quantity' => 'required|string|max:50',
            'reference' => 'required|string|min:4|max:80']);
        $result = DB::transaction(function () use ($user, $data) {
            $account = DB::table('Account')->where('userId', $user->id)->lockForUpdate()->first();
            if (! $account) {
                Guard::fail('NOT_FOUND', 'Account not found', 404);
            }
            $wallet = DB::table('ReceivingWallet')->where('id', $data['walletId'])->first();
            if (! $wallet) {
                Guard::fail('NOT_FOUND', 'Receiving wallet not found.', 404);
            }
            $units = CryptoAssets::units($wallet->assetKey, $data['quantity']);
            $existing = DB::table('DepositRequest')->where('reference', $data['reference'])->first();
            if ($existing) {
                if ($existing->userId !== $user->id || $existing->assetKey !== $wallet->assetKey
                    || $existing->quantityAtomic !== $units) {
                    Guard::fail('CONFLICT', 'This reference belongs to a different deposit.', 409);
                }

                return $existing;
            }
            if (! $wallet->isActive) {
                Guard::fail('WALLET_UNAVAILABLE', 'This receiving wallet is no longer accepting new deposits.', 409);
            }
            CryptoAssets::address($wallet->assetKey, $wallet->address);
            $asset = CryptoAssets::get($wallet->assetKey);
            $id = Qfs::id();
            DB::table('DepositRequest')->insert([
                'id' => $id, 'userId' => $user->id, 'amountCents' => 0, 'method' => $asset['symbol'].' · '.$asset['network'],
                'reference' => $data['reference'], 'assetKey' => $wallet->assetKey, 'quantityAtomic' => $units,
                'fundingSource' => 'CRYPTO', 'receivingAddress' => $wallet->address,
                'destinationTag' => $wallet->destinationTag ?? null,
            ]);

            return DB::table('DepositRequest')->where('id', $id)->first();
        });

        return Api::ok(['request' => ['id' => $result->id, 'reference' => $result->reference, 'status' => $result->status, ...CryptoFunds::requestInfo($result)]]);
    }

    public function attachTransfer(Request $request, string $id): JsonResponse
    {
        $user = Guard::user($request);
        $data = $request->validate(['txHash' => 'sometimes|nullable|string|max:100']);
        DB::transaction(function () use ($user, $data, $id) {
            DB::table('Account')->where('userId', $user->id)->lockForUpdate()->first();
            $item = DB::table('DepositRequest')->where('id', $id)->where('userId', $user->id)->lockForUpdate()->first();
            if (! $item || ! $item->assetKey) {
                Guard::fail('NOT_FOUND', 'Deposit not found.', 404);
            }
            $hash = trim($data['txHash'] ?? '');
            $key = $hash === '' ? null : CryptoAssets::txKey($item->assetKey, $hash);
            if ($key !== null && $item->chainTxKey === $key) {
                return;
            }
            if ($item->status !== 'PENDING' || ($key !== null && $item->chainTxKey)) {
                Guard::fail('CONFLICT', 'This deposit can no longer be changed.', 409);
            }
            if ($hash !== '') {
                DB::table('DepositRequest')->where('id', $id)->update(CryptoFunds::claimDepositTransfer($item, $hash));
            }
        });

        return Api::ok(['submitted' => true]);
    }

    public function withdrawal(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $data = $request->validate(['quoteId' => 'required|string|max:64', 'address' => 'required|string|max:120', 'destinationTag' => 'nullable|string|max:10',
            'reference' => 'required|string|min:4|max:80']);
        $result = DB::transaction(function () use ($user, $data) {
            $account = DB::table('Account')->where('userId', $user->id)->lockForUpdate()->first();
            if (! $account) {
                Guard::fail('NOT_FOUND', 'Account not found', 404);
            }
            $existing = DB::table('WithdrawalRequest')->where('reference', $data['reference'])->first();
            if ($existing) {
                if ($existing->userId !== $user->id || $existing->quoteId !== $data['quoteId']
                    || $existing->receivingAddress !== CryptoAssets::address($existing->assetKey, $data['address'])
                    || ($existing->destinationTag ?? null) !== CryptoAssets::destinationTag($existing->assetKey, $data['destinationTag'] ?? null)) {
                    Guard::fail('CONFLICT', 'This reference belongs to a different withdrawal.', 409);
                }

                return $existing;
            }
            $row = DB::table('CryptoQuote')->where('id', $data['quoteId'])->where('userId', $user->id)->first();
            if (! $row || ! in_array($row->purpose, ['CRYPTO_WITHDRAWAL', 'USD_WITHDRAWAL'], true)) {
                Guard::fail('QUOTE', 'Select a valid withdrawal quote.', 400);
            }
            $quote = CryptoFunds::quote($user->id, $row->id, $row->purpose);
            $asset = CryptoAssets::get($quote->assetKey);
            $address = CryptoAssets::address($quote->assetKey, $data['address']);
            $destinationTag = CryptoAssets::destinationTag($quote->assetKey, $data['destinationTag'] ?? null);
            $this->withdrawalLimits($user->id, $quote->amountCents);
            $id = Qfs::id();
            $usd = $quote->purpose === 'USD_WITHDRAWAL';
            if ($usd) {
                if ($account->availableCents < $quote->amountCents) {
                    Guard::fail('INSUFFICIENT_FUNDS', 'Insufficient available USD balance.', 400);
                }
                DB::table('Account')->where('id', $account->id)->update(['availableCents' => $account->availableCents - $quote->amountCents, 'updatedAt' => Qfs::now()]);
                DB::table('LedgerEntry')->insert([
                    'id' => Qfs::id(), 'accountId' => $account->id, 'movement' => 'DEBIT', 'amountCents' => $quote->amountCents,
                    'balanceAfterCents' => $account->balanceCents, 'note' => 'USD reserved for crypto withdrawal ('.$data['reference'].')',
                ]);
            } else {
                $balance = CryptoFunds::balance($user->id, $quote->assetKey);
                CryptoFunds::move($balance, '0', $quote->quantityAtomic, 'RESERVE', $quote->quantityAtomic, 'WD-'.$id);
            }
            DB::table('WithdrawalRequest')->insert([
                'id' => $id, 'userId' => $user->id, 'amountCents' => $quote->amountCents, 'method' => $asset['symbol'].' · '.$asset['network'],
                'details' => $address, 'reference' => $data['reference'], 'assetKey' => $quote->assetKey,
                'quantityAtomic' => $quote->quantityAtomic, 'fundingSource' => $usd ? 'USD' : 'CRYPTO',
                'receivingAddress' => $address, 'quoteId' => $quote->id,
                'destinationTag' => $destinationTag,
            ]);
            DB::table('CryptoQuote')->where('id', $quote->id)->update(['usedAt' => Qfs::now()]);

            return DB::table('WithdrawalRequest')->where('id', $id)->first();
        });

        return Api::ok(['request' => ['id' => $result->id, 'type' => 'WITHDRAWAL', 'reference' => $result->reference,
            'status' => $result->status, 'createdAt' => $result->createdAt, ...CryptoFunds::requestInfo($result)]]);
    }

    private function withdrawalLimits(string $userId, int $cents): void
    {
        $minimum = (int) (DB::table('Setting')->where('key', 'min_withdrawal_cents')->value('value') ?? 0);
        if ($cents < $minimum) {
            Guard::fail('WITHDRAWAL_LIMIT', LocalizedText::translate('Minimum withdrawal is {amount}.', ['amount' => Qfs::money($minimum)]), 400);
        }
        $maximum = (int) (DB::table('Setting')->where('key', 'max_withdrawal_daily_cents')->value('value') ?? 0);
        if ($maximum > 0) {
            $used = (int) DB::table('WithdrawalRequest')->where('userId', $userId)
                ->where('createdAt', '>=', now()->subDay())->where('status', '!=', 'REJECTED')->sum('amountCents');
            if ($used + $cents > $maximum) {
                Guard::fail('WITHDRAWAL_LIMIT', LocalizedText::translate('You can withdraw up to {amount} within the current 24-hour limit.', ['amount' => Qfs::money(max(0, $maximum - $used))]), 400);
            }
        }
    }
}
