<?php

namespace App\Support;

use Brick\Math\BigDecimal;
use Brick\Math\BigInteger;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

final class CryptoSwaps
{
    public const TERMINAL = ['COMPLETED', 'CANCELLED', 'REFUNDED'];

    public const USD = 'USD';

    public static function enabled(): bool
    {
        return (bool) config('services.swaps.enabled') && SwapProvider::configured();
    }

    public static function isUsd(string $key): bool
    {
        return $key === self::USD;
    }

    public static function isInternal(object $swap): bool
    {
        $routing = is_string($swap->routing ?? null) ? json_decode($swap->routing, true) : ($swap->routing ?? []);

        return ($routing['kind'] ?? null) === 'INTERNAL';
    }

    public static function assetInfo(string $key): array
    {
        if (self::isUsd($key)) {
            return ['symbol' => 'USD', 'network' => 'Account', 'explorer' => null];
        }

        return CryptoAssets::get($key);
    }

    public static function formatAmount(string $key, ?string $atomic): ?string
    {
        if ($atomic === null || $atomic === '') {
            return null;
        }
        if (self::isUsd($key)) {
            return number_format(((int) $atomic) / 100, 2, '.', '');
        }

        return CryptoAssets::quantity($key, $atomic);
    }

    public static function amountLabel(string $from, string $fromAtomic, string $to, string $toAtomic): string
    {
        $fromInfo = self::assetInfo($from);
        $toInfo = self::assetInfo($to);
        $fromQty = self::isUsd($from) ? Qfs::money((int) $fromAtomic) : self::formatAmount($from, $fromAtomic).' '.$fromInfo['symbol'];
        $toQty = self::isUsd($to) ? Qfs::money((int) $toAtomic) : self::formatAmount($to, $toAtomic).' '.$toInfo['symbol'];

        return $fromQty.' → '.$toQty;
    }

    /** Dashboard catalog: USD plus every funded network, independent of Changelly. */
    public static function catalog(): array
    {
        $assets = [['assetKey' => self::USD, 'from' => true, 'to' => true, 'symbol' => 'USD', 'network' => 'Account']];
        foreach (CryptoAssets::ALL as $key => $asset) {
            $assets[] = ['assetKey' => $key, 'from' => true, 'to' => true, 'symbol' => $asset['symbol'], 'network' => $asset['network']];
        }

        return $assets;
    }

    public static function describe(object $swap, bool $admin = false): array
    {
        $from = self::assetInfo($swap->fromAsset);
        $to = self::assetInfo($swap->toAsset);
        $result = [
            'id' => $swap->id, 'reference' => $swap->reference, 'status' => $swap->status,
            'fromAsset' => $swap->fromAsset, 'toAsset' => $swap->toAsset,
            'fromSymbol' => $from['symbol'], 'toSymbol' => $to['symbol'],
            'fromNetwork' => $from['network'], 'toNetwork' => $to['network'],
            'quantity' => self::formatAmount($swap->fromAsset, $swap->fromAtomic),
            'quotedQuantity' => self::formatAmount($swap->toAsset, $swap->toAtomic),
            'receivedQuantity' => self::formatAmount($swap->toAsset, $swap->receivedAtomic),
            'payoutUrl' => $swap->payoutHash && ! empty($to['explorer']) ? $to['explorer'].$swap->payoutHash : null,
            'refundQuantity' => $swap->status === 'REFUNDED' ? self::formatAmount($swap->fromAsset, DB::table('CryptoLedger')->where('reference', 'SWAP-REFUND-'.$swap->id)->value('quantityAtomic')) : null,
            'createdAt' => CarbonImmutable::parse($swap->createdAt)->toIso8601String(),
            'completedAt' => $swap->completedAt ? CarbonImmutable::parse($swap->completedAt)->toIso8601String() : null,
        ];
        if ($admin) {
            $result += [
                'userId' => $swap->userId, 'providerId' => $swap->providerId, 'providerStatus' => $swap->providerStatus,
                'payinAddress' => $swap->payinAddress, 'payinTag' => $swap->payinTag, 'payinHash' => $swap->payinHash,
                'refundHash' => $swap->refundHash, 'routing' => json_decode($swap->routing, true),
                'refundUrl' => $swap->refundHash && ! empty($from['explorer']) ? $from['explorer'].$swap->refundHash : null,
                'payTill' => $swap->payTill ? CarbonImmutable::parse($swap->payTill)->toIso8601String() : null,
                'fundingAttemptAt' => $swap->fundingAttemptAt, 'lastError' => $swap->lastError, 'lastCheckedAt' => $swap->lastCheckedAt,
            ];
        }

        return $result;
    }

    public static function estimate(string $userId, string $from, string $to, string $quantity): array
    {
        if ($from === $to) {
            Guard::fail('SWAP_PAIR', 'Choose two different assets or networks.', 400);
        }
        if (self::isUsd($from) || self::isUsd($to) || ! self::enabled()) {
            return self::estimateInternal($userId, $from, $to, $quantity);
        }
        $units = CryptoAssets::units($from, $quantity);
        CryptoAssets::get($to);
        $balance = DB::table('CryptoBalance')->where('userId', $userId)->where('assetKey', $from)->first();
        if (! $balance || BigInteger::of($balance->totalAtomic)->minus($balance->reservedAtomic)->isLessThan($units)) {
            Guard::fail('INSUFFICIENT_FUNDS', 'Insufficient available crypto balance.', 400);
        }
        $routes = SwapProvider::routes(true);
        if (empty($routes[$from]['from']) || empty($routes[$to]['to'])) {
            Guard::fail('SWAP_PAIR', 'This swap pair is temporarily unavailable.', 409);
        }
        $rate = SwapProvider::estimate($routes[$from]['ticker'], $routes[$to]['ticker'], CryptoAssets::quantity($from, $units));
        $out = SwapProvider::atomic($to, $rate['amountTo']);
        $expiry = min((int) $rate['expiredAt'], now()->timestamp + 50);
        if ($expiry <= now()->timestamp + 5 || ! is_string($rate['networkFee']) || BigDecimal::of($rate['networkFee'])->isNegative()) {
            throw new SwapProviderException;
        }
        $id = Qfs::id();
        DB::table('SwapQuote')->insert([
            'id' => $id, 'userId' => $userId, 'fromAsset' => $from, 'toAsset' => $to, 'fromAtomic' => $units, 'toAtomic' => $out,
            'networkFee' => $rate['networkFee'], 'providerRateId' => $rate['id'], 'routing' => json_encode(['from' => $routes[$from], 'to' => $routes[$to]]),
            'expiresAt' => date('Y-m-d H:i:s', $expiry),
        ]);

        return ['id' => $id, 'fromAsset' => $from, 'toAsset' => $to, 'quantity' => CryptoAssets::quantity($from, $units),
            'receiveQuantity' => CryptoAssets::quantity($to, $out), 'networkFee' => $rate['networkFee'],
            'expiresAt' => gmdate(DATE_ATOM, $expiry)];
    }

    /** Instant ledger conversion using live USD prices (crypto ↔ USD or crypto ↔ crypto). */
    public static function estimateInternal(string $userId, string $from, string $to, string $quantity): array
    {
        if (self::isUsd($from) && self::isUsd($to)) {
            Guard::fail('SWAP_PAIR', 'Choose two different assets or networks.', 400);
        }
        $account = DB::table('Account')->where('userId', $userId)->first();
        if (! $account) {
            Guard::fail('NOT_FOUND', 'Account not found', 404);
        }
        $fromPrice = self::isUsd($from) ? null : CryptoPrices::require($from);
        $toPrice = self::isUsd($to) ? null : CryptoPrices::require($to);
        if (self::isUsd($from)) {
            $cents = Qfs::cents($quantity);
            if ($cents === null) {
                Guard::fail('AMOUNT', 'Enter a valid USD amount with at most two decimal places.', 400);
            }
            if ($account->availableCents < $cents) {
                Guard::fail('INSUFFICIENT_FUNDS', 'Insufficient available USD balance.', 400);
            }
            $fromAtomic = (string) $cents;
            $toAtomic = CryptoAssets::fromUsd($to, $cents, $toPrice['rate'], false);
        } else {
            $fromAtomic = CryptoAssets::units($from, $quantity);
            $balance = DB::table('CryptoBalance')->where('userId', $userId)->where('assetKey', $from)->first();
            if (! $balance || BigInteger::of($balance->totalAtomic)->minus($balance->reservedAtomic)->isLessThan($fromAtomic)) {
                Guard::fail('INSUFFICIENT_FUNDS', 'Insufficient available crypto balance.', 400);
            }
            $cents = CryptoAssets::usd($from, $fromAtomic, $fromPrice['rate']);
            if ($cents < 1) {
                Guard::fail('LIMIT', 'The quoted USD value must be at least $0.01.', 400);
            }
            $toAtomic = self::isUsd($to) ? (string) $cents : CryptoAssets::fromUsd($to, $cents, $toPrice['rate'], false);
        }
        $stamps = array_filter([$fromPrice['timestamp'] ?? null, $toPrice['timestamp'] ?? null]);
        $expiry = min(now()->timestamp + 50, ...array_map(fn ($stamp) => $stamp + 90, $stamps));
        if ($expiry <= now()->timestamp + 5) {
            Guard::fail('PRICE_UNAVAILABLE', 'A fresh crypto price is unavailable. Please try again shortly.', 503);
        }
        $id = Qfs::id();
        DB::table('SwapQuote')->insert([
            'id' => $id, 'userId' => $userId, 'fromAsset' => $from, 'toAsset' => $to,
            'fromAtomic' => $fromAtomic, 'toAtomic' => $toAtomic, 'networkFee' => '0',
            'providerRateId' => 'INTERNAL-'.$id, 'routing' => json_encode(['kind' => 'INTERNAL', 'usdCents' => $cents]),
            'expiresAt' => date('Y-m-d H:i:s', $expiry),
        ]);

        return [
            'id' => $id, 'fromAsset' => $from, 'toAsset' => $to,
            'quantity' => self::formatAmount($from, $fromAtomic),
            'receiveQuantity' => self::formatAmount($to, $toAtomic),
            'networkFee' => '0', 'internal' => true,
            'expiresAt' => gmdate(DATE_ATOM, $expiry),
        ];
    }

    /** Commit a one-use quote and its reservation before any external action. */
    public static function reserve(string $userId, string $quoteId, string $reference): object
    {
        return DB::transaction(function () use ($userId, $quoteId, $reference) {
            $account = self::account($userId);
            $existing = DB::table('CryptoSwap')->where('reference', $reference)->first();
            if ($existing) {
                if ($existing->userId !== $userId || $existing->quoteId !== $quoteId) {
                    Guard::fail('CONFLICT', 'This reference belongs to a different swap.', 409);
                }

                return $existing;
            }
            $quote = DB::table('SwapQuote')->where('id', $quoteId)->where('userId', $userId)->lockForUpdate()->first();
            if (! $quote || $quote->usedAt || now()->greaterThanOrEqualTo($quote->expiresAt)) {
                Guard::fail('QUOTE_EXPIRED', 'This quote is unavailable or expired. Request a new quote.', 409);
            }
            $routes = json_decode($quote->routing, true) ?: [];
            if (($routes['kind'] ?? null) === 'INTERNAL') {
                return self::settleInternal($account, $quote, $reference);
            }
            if (! self::enabled()) {
                Guard::fail('SWAPS_UNAVAILABLE', 'Crypto swaps are not available yet.', 503);
            }
            foreach (['from' => $quote->fromAsset, 'to' => $quote->toAsset] as $side => $asset) {
                $route = DB::table('SwapAsset')->where('assetKey', $asset)->where('isActive', true)->first();
                if (! $route || $route->walletId !== $routes[$side]['walletId'] || $route->providerTicker !== $routes[$side]['ticker']
                    || ! DB::table('ReceivingWallet')->where('id', $route->walletId)->where('isActive', true)->exists()) {
                    Guard::fail('SWAP_PAIR', 'This swap pair is temporarily unavailable.', 409);
                }
            }
            if (DB::table('CryptoSwap')->where('userId', $userId)->whereNotIn('status', self::TERMINAL)->count() >= 5) {
                Guard::fail('SWAP_LIMIT', 'Wait for a pending swap to finish before starting another.', 409);
            }
            $id = Qfs::id();
            CryptoFunds::move(CryptoFunds::balance($userId, $quote->fromAsset), '0', $quote->fromAtomic, 'SWAP_RESERVE', $quote->fromAtomic, 'SWAP-RESERVE-'.$id);
            DB::table('SwapQuote')->where('id', $quoteId)->update(['usedAt' => Qfs::now()]);
            DB::table('CryptoSwap')->insert([
                'id' => $id, 'userId' => $userId, 'reference' => $reference, 'quoteId' => $quoteId, 'fromAsset' => $quote->fromAsset,
                'toAsset' => $quote->toAsset, 'fromAtomic' => $quote->fromAtomic, 'toAtomic' => $quote->toAtomic, 'routing' => $quote->routing,
            ]);

            return DB::table('CryptoSwap')->where('id', $id)->first();
        });
    }

    private static function settleInternal(object $account, object $quote, string $reference): object
    {
        $routing = json_decode($quote->routing, true) ?: [];
        $cents = self::isUsd($quote->fromAsset)
            ? (int) $quote->fromAtomic
            : (self::isUsd($quote->toAsset) ? (int) $quote->toAtomic : (int) ($routing['usdCents'] ?? 0));
        if ($cents < 1) {
            Guard::fail('LIMIT', 'The quoted USD value must be at least $0.01.', 400);
        }
        $id = Qfs::id();
        $now = Qfs::now();
        if (self::isUsd($quote->fromAsset)) {
            if ($account->availableCents < $cents || $account->balanceCents < $cents) {
                Guard::fail('INSUFFICIENT_FUNDS', 'Insufficient available USD balance.', 400);
            }
            $newBalance = $account->balanceCents - $cents;
            $newAvailable = $account->availableCents - $cents;
            DB::table('Account')->where('id', $account->id)->update([
                'balanceCents' => $newBalance, 'availableCents' => $newAvailable, 'updatedAt' => $now,
            ]);
            CryptoFunds::move(CryptoFunds::balance($account->userId, $quote->toAsset), $quote->toAtomic, '0', 'SWAP_IN', $quote->toAtomic, 'SWAP-IN-'.$id);
        } else {
            CryptoFunds::move(CryptoFunds::balance($account->userId, $quote->fromAsset), '-'.$quote->fromAtomic, '0', 'SWAP_OUT', $quote->fromAtomic, 'SWAP-OUT-'.$id);
            if (self::isUsd($quote->toAsset)) {
                $newBalance = $account->balanceCents + $cents;
                $newAvailable = $account->availableCents + $cents;
                if ($newBalance > 2147483647 || $newAvailable > 2147483647) {
                    Guard::fail('BALANCE_LIMIT', 'Account balance limit exceeded', 400);
                }
                DB::table('Account')->where('id', $account->id)->update([
                    'balanceCents' => $newBalance, 'availableCents' => $newAvailable, 'updatedAt' => $now,
                ]);
            } else {
                $newBalance = $account->balanceCents;
                CryptoFunds::move(CryptoFunds::balance($account->userId, $quote->toAsset), $quote->toAtomic, '0', 'SWAP_IN', $quote->toAtomic, 'SWAP-IN-'.$id);
            }
        }
        $txId = Qfs::id();
        DB::table('Transaction')->insert([
            'id' => $txId, 'userId' => $account->userId, 'type' => 'SWAP', 'amountCents' => $cents, 'status' => 'COMPLETED',
            'assetKey' => self::isUsd($quote->fromAsset) ? $quote->toAsset : $quote->fromAsset,
            'quantityAtomic' => self::isUsd($quote->fromAsset) ? $quote->toAtomic : $quote->fromAtomic,
            'method' => 'Account swap', 'reference' => 'SWAP-'.$id,
            'completedAt' => $now, 'note' => 'Account swap completed',
            'meta' => json_encode([
                'swapId' => $id, 'fromAsset' => $quote->fromAsset, 'toAsset' => $quote->toAsset,
                'fromAtomic' => $quote->fromAtomic, 'receivedAtomic' => $quote->toAtomic,
            ]),
        ]);
        if (self::isUsd($quote->fromAsset) || self::isUsd($quote->toAsset)) {
            DB::table('LedgerEntry')->insert([
                'id' => Qfs::id(), 'accountId' => $account->id,
                'movement' => self::isUsd($quote->fromAsset) ? 'DEBIT' : 'CREDIT',
                'amountCents' => $cents,
                'balanceAfterCents' => $newBalance,
                'txId' => $txId,
                'note' => 'Account swap ('.$reference.')',
            ]);
        }
        DB::table('SwapQuote')->where('id', $quote->id)->update(['usedAt' => $now]);
        DB::table('CryptoSwap')->insert([
            'id' => $id, 'userId' => $account->userId, 'reference' => $reference, 'quoteId' => $quote->id,
            'fromAsset' => $quote->fromAsset, 'toAsset' => $quote->toAsset,
            'fromAtomic' => $quote->fromAtomic, 'toAtomic' => $quote->toAtomic, 'receivedAtomic' => $quote->toAtomic,
            'status' => 'COMPLETED', 'routing' => $quote->routing, 'completedAt' => $now, 'updatedAt' => $now,
        ]);
        AdminLog::notify($account->userId, 'Swap completed', 'Your exchanged funds are now available.');

        return DB::table('CryptoSwap')->where('id', $id)->first();
    }

    public static function create(string $id): void
    {
        $swap = DB::table('CryptoSwap')->where('id', $id)->first();
        if (! $swap || self::isInternal($swap) || $swap->status !== 'CREATING' || $swap->providerId) {
            return;
        }
        // A committed marker prevents concurrent requests from creating a second external order.
        if (! DB::table('CryptoSwap')->where('id', $id)->where('status', 'CREATING')->update(['status' => 'OPENING', 'updatedAt' => Qfs::now()])) {
            return;
        }
        $route = json_decode($swap->routing, true);
        $quote = DB::table('SwapQuote')->where('id', $swap->quoteId)->first();
        try {
            $order = SwapProvider::call('createFixTransaction', array_filter([
                'from' => $route['from']['ticker'], 'to' => $route['to']['ticker'], 'rateId' => $quote->providerRateId,
                'amountFrom' => CryptoAssets::quantity($swap->fromAsset, $swap->fromAtomic),
                'address' => $route['to']['address'], 'extraId' => $route['to']['tag'],
                'refundAddress' => $route['from']['address'], 'refundExtraId' => $route['from']['tag'],
            ], fn ($value) => $value !== null));
            self::attach($id, $order);
        } catch (SwapProviderException $error) {
            if ($error->definitive) {
                self::release($id);
            } else {
                self::attention($id, 'Order creation needs reconciliation. Do not create or fund a replacement order.');
            }
        } catch (\Throwable) {
            self::attention($id, 'Order details need review before any treasury payment.');
        }
    }

    public static function attach(string $id, array $order): void
    {
        $swap = DB::table('CryptoSwap')->where('id', $id)->first();
        self::validateOrder($swap, $order);
        $address = CryptoAssets::address($swap->fromAsset, $order['payinAddress'] ?? '');
        $tag = CryptoAssets::destinationTag($swap->fromAsset, isset($order['payinExtraId']) ? (string) $order['payinExtraId'] : null);
        if (empty($order['payTill'])) {
            throw new SwapProviderException;
        }
        $deadline = CarbonImmutable::parse($order['payTill']);
        $net = BigDecimal::of((string) ($order['amountExpectedTo'] ?? '0'))->minus((string) ($order['networkFee'] ?? '0'));
        if ($net->isLessThan(BigDecimal::of(CryptoAssets::quantity($swap->toAsset, $swap->toAtomic)))) {
            throw new SwapProviderException;
        }
        DB::transaction(function () use ($swap, $order, $address, $tag, $deadline) {
            self::account($swap->userId);
            $locked = DB::table('CryptoSwap')->where('id', $swap->id)->lockForUpdate()->first();
            if (in_array($locked->status, self::TERMINAL, true) || ($locked->providerId && $locked->providerId !== $order['id'])) {
                Guard::fail('CONFLICT', 'This swap can no longer be changed.', 409);
            }
            if (! $locked->providerId) {
                DB::table('CryptoSwap')->where('id', $swap->id)->update([
                    'providerId' => $order['id'], 'payinAddress' => $address, 'payinTag' => $tag, 'payTill' => $deadline->toDateTimeString(),
                    'status' => 'AWAITING_FUNDING', 'lastError' => null, 'updatedAt' => Qfs::now(),
                ]);
            }
        });
    }

    private static function validateOrder(object $swap, array $order): void
    {
        $route = json_decode($swap->routing, true);
        if (empty($order['id']) || ($order['type'] ?? null) !== 'fixed'
            || ($order['currencyFrom'] ?? null) !== $route['from']['ticker'] || ($order['currencyTo'] ?? null) !== $route['to']['ticker']
            || CryptoAssets::address($swap->toAsset, $order['payoutAddress'] ?? '') !== $route['to']['address']
            || CryptoAssets::address($swap->fromAsset, $order['refundAddress'] ?? '') !== $route['from']['address']
            || CryptoAssets::destinationTag($swap->toAsset, isset($order['payoutExtraId']) ? (string) $order['payoutExtraId'] : null) !== $route['to']['tag']
            || CryptoAssets::destinationTag($swap->fromAsset, isset($order['refundExtraId']) ? (string) $order['refundExtraId'] : null) !== $route['from']['tag']
            || BigDecimal::of((string) ($order['amountExpectedFrom'] ?? '0'))->compareTo(CryptoAssets::quantity($swap->fromAsset, $swap->fromAtomic)) !== 0) {
            throw new SwapProviderException;
        }
    }

    /** Only independently queried provider records can settle a swap. */
    public static function sync(string $id): void
    {
        $swap = DB::table('CryptoSwap')->where('id', $id)->first();
        if (! $swap || in_array($swap->status, self::TERMINAL, true) || ! $swap->providerId) {
            return;
        }
        try {
            $order = SwapProvider::transaction($swap->providerId);
            self::validateOrder($swap, $order);
            if (CryptoAssets::address($swap->fromAsset, $order['payinAddress'] ?? '') !== $swap->payinAddress
                || CryptoAssets::destinationTag($swap->fromAsset, isset($order['payinExtraId']) ? (string) $order['payinExtraId'] : null) !== $swap->payinTag) {
                throw new SwapProviderException;
            }
            $state = $order['status'] ?? '';
            DB::transaction(function () use ($swap, $order, $state) {
                self::account($swap->userId);
                $row = DB::table('CryptoSwap')->where('id', $swap->id)->lockForUpdate()->first();
                if (in_array($row->status, self::TERMINAL, true)) {
                    return;
                }
                $update = ['providerStatus' => $state, 'lastCheckedAt' => Qfs::now(), 'updatedAt' => Qfs::now()];
                if ($state === 'finished') {
                    $actual = SwapProvider::atomic($row->toAsset, $order['amountTo'] ?? null);
                    if (BigInteger::of($actual)->isLessThan($row->toAtomic)
                        || SwapProvider::atomic($row->fromAsset, $order['amountFrom'] ?? null) !== $row->fromAtomic) {
                        throw new SwapProviderException;
                    }
                    $hash = CryptoAssets::hash($row->toAsset, $order['payoutHash'] ?? '');
                    $key = CryptoAssets::txKey($row->toAsset, $hash);
                    if (DB::table('DepositRequest')->where('chainTxKey', $key)->exists()) {
                        throw new SwapProviderException;
                    }
                    self::claimProviderTransfer($key, 'SWAP-PAYOUT-'.$row->id);
                    CryptoFunds::move(CryptoFunds::balance($row->userId, $row->fromAsset), '-'.$row->fromAtomic, '-'.$row->fromAtomic, 'SWAP_OUT', $row->fromAtomic, 'SWAP-OUT-'.$row->id);
                    CryptoFunds::move(CryptoFunds::balance($row->userId, $row->toAsset), $actual, '0', 'SWAP_IN', $actual, 'SWAP-IN-'.$row->id);
                    DB::table('Transaction')->insert([
                        'id' => Qfs::id(), 'userId' => $row->userId, 'type' => 'SWAP', 'amountCents' => 0, 'status' => 'COMPLETED',
                        'assetKey' => $row->fromAsset, 'quantityAtomic' => $row->fromAtomic, 'method' => 'Crypto swap', 'reference' => 'SWAP-'.$row->id,
                        'completedAt' => Qfs::now(), 'note' => 'Crypto swap completed',
                        'meta' => json_encode(['swapId' => $row->id, 'toAsset' => $row->toAsset, 'receivedAtomic' => $actual]),
                    ]);
                    AdminLog::notify($row->userId, 'Swap completed', 'Your exchanged crypto is now available.');
                    $update += ['status' => 'COMPLETED', 'receivedAtomic' => $actual, 'payoutHash' => $hash, 'payoutTxKey' => $key, 'completedAt' => Qfs::now(), 'lastError' => null];
                } elseif ($state === 'expired' && ! $row->fundingAttemptAt && empty($order['payinHash']) && empty($order['moneyReceived'])) {
                    self::release($row->id);

                    return;
                } elseif (in_array($state, ['hold', 'failed', 'refunded', 'overdue', 'expired'], true)) {
                    $update += ['status' => 'NEEDS_REVIEW', 'lastError' => $state === 'refunded' ? 'Verify the returned amount on the source network before recording a refund.' : 'Provider action is required. Keep funds reserved until the outcome is verified.'];
                    if ($state === 'refunded' && ! empty($order['refundHash'])) {
                        $update['refundHash'] = CryptoAssets::hash($row->fromAsset, $order['refundHash']);
                    }
                } elseif (in_array($state, ['confirming', 'exchanging', 'sending'], true)) {
                    $update += ['status' => 'PROCESSING', 'lastError' => null];
                } elseif (! in_array($state, ['new', 'waiting'], true)) {
                    throw new SwapProviderException;
                }
                DB::table('CryptoSwap')->where('id', $row->id)->update($update);
            });
        } catch (\Throwable) {
            self::attention($id, 'Settlement could not be verified. Funds remain reserved.');
        }
    }

    public static function release(string $id): void
    {
        $swap = DB::table('CryptoSwap')->where('id', $id)->first();
        DB::transaction(function () use ($swap) {
            self::account($swap->userId);
            $row = DB::table('CryptoSwap')->where('id', $swap->id)->lockForUpdate()->first();
            if (in_array($row->status, self::TERMINAL, true) || $row->fundingAttemptAt || $row->payinHash) {
                return;
            }
            CryptoFunds::move(CryptoFunds::balance($row->userId, $row->fromAsset), '0', '-'.$row->fromAtomic, 'SWAP_RELEASE', $row->fromAtomic, 'SWAP-RELEASE-'.$row->id);
            DB::table('CryptoSwap')->where('id', $row->id)->update(['status' => 'CANCELLED', 'completedAt' => Qfs::now(), 'lastError' => null, 'updatedAt' => Qfs::now()]);
        });
    }

    public static function refund(string $id, string $quantity, string $adminId): void
    {
        $swap = DB::table('CryptoSwap')->where('id', $id)->first();
        $order = SwapProvider::transaction($swap->providerId ?? '');
        self::validateOrder($swap, $order);
        if (($order['status'] ?? '') !== 'refunded') {
            Guard::fail('REFUND', 'The provider has not confirmed a refund.', 409);
        }
        $hash = CryptoAssets::hash($swap->fromAsset, $order['refundHash'] ?? '');
        $key = CryptoAssets::txKey($swap->fromAsset, $hash);
        $actual = CryptoAssets::units($swap->fromAsset, $quantity);
        if (BigInteger::of($actual)->isGreaterThan($swap->fromAtomic)) {
            Guard::fail('REFUND', 'The refund cannot exceed the reserved quantity.', 400);
        }
        DB::transaction(function () use ($swap, $actual, $hash, $key, $adminId) {
            self::account($swap->userId);
            $row = DB::table('CryptoSwap')->where('id', $swap->id)->lockForUpdate()->first();
            if (in_array($row->status, self::TERMINAL, true) || DB::table('DepositRequest')->where('chainTxKey', $key)->exists()) {
                Guard::fail('CONFLICT', 'This swap can no longer be changed.', 409);
            }
            $loss = (string) BigInteger::of($row->fromAtomic)->minus($actual);
            self::claimProviderTransfer($key, 'SWAP-REFUND-'.$row->id);
            CryptoFunds::move(CryptoFunds::balance($row->userId, $row->fromAsset), '-'.$loss, '-'.$row->fromAtomic, 'SWAP_REFUND', $actual, 'SWAP-REFUND-'.$row->id);
            DB::table('CryptoSwap')->where('id', $row->id)->update([
                'status' => 'REFUNDED', 'refundHash' => $hash, 'refundTxKey' => $key, 'providerStatus' => 'refunded',
                'lastError' => null, 'completedAt' => Qfs::now(), 'updatedAt' => Qfs::now(),
            ]);
            AdminLog::audit($adminId, 'SWAP.REFUND', 'CryptoSwap', $row->id, ['quantityAtomic' => $actual, 'refundHash' => $hash]);
            AdminLog::notify($row->userId, 'Swap refunded', 'The returned crypto is available in your balance.');
        });
    }

    public static function releaseVerifiedUnfunded(string $id, string $adminId, bool $verified): void
    {
        if (! $verified || SwapTreasury::automatic()) {
            Guard::fail('SWAP_FUNDING', 'Verify that no treasury payment was sent before releasing an expired order.', 400);
        }
        $swap = DB::table('CryptoSwap')->where('id', $id)->first();
        $order = SwapProvider::transaction($swap->providerId ?? '');
        self::validateOrder($swap, $order);
        if (($order['status'] ?? '') !== 'expired' || ! empty($order['payinHash']) || ! empty($order['moneyReceived'])) {
            Guard::fail('SWAP_FUNDING', 'This order is not confirmed expired and unfunded.', 409);
        }
        DB::transaction(function () use ($swap, $adminId) {
            self::account($swap->userId);
            $row = DB::table('CryptoSwap')->where('id', $swap->id)->lockForUpdate()->first();
            if (in_array($row->status, self::TERMINAL, true) || $row->payinHash) {
                Guard::fail('CONFLICT', 'This swap can no longer be changed.', 409);
            }
            AdminLog::audit($adminId, 'SWAP.VERIFIED_UNFUNDED', 'CryptoSwap', $row->id, ['providerId' => $row->providerId, 'fundingAttemptAt' => $row->fundingAttemptAt]);
            DB::table('CryptoSwap')->where('id', $row->id)->update(['fundingAttemptAt' => null, 'providerStatus' => 'expired']);
            self::release($row->id);
        });
    }

    public static function attention(string $id, string $message): void
    {
        DB::table('CryptoSwap')->where('id', $id)->whereNotIn('status', self::TERMINAL)->update([
            'status' => 'NEEDS_REVIEW', 'lastError' => $message, 'lastCheckedAt' => Qfs::now(), 'updatedAt' => Qfs::now(),
        ]);
    }

    /** A provider may batch distinct orders. Block manual deposit reuse of the whole transaction. */
    private static function claimProviderTransfer(string $key, string $reference): void
    {
        DB::table('CryptoTransferClaim')->insertOrIgnore(['chainTxKey' => $key, 'reference' => $reference]);
        $claim = DB::table('CryptoTransferClaim')->where('chainTxKey', $key)->first();
        if (! $claim || (! str_starts_with($claim->reference, 'SWAP-PAYOUT-') && ! str_starts_with($claim->reference, 'SWAP-REFUND-'))) {
            throw new SwapProviderException;
        }
    }

    public static function account(string $userId): object
    {
        return DB::table('Account')->where('userId', $userId)->lockForUpdate()->first()
            ?? Guard::fail('NOT_FOUND', 'Account not found', 404);
    }
}
