<?php

namespace App\Support;

use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

final class SwapProvider
{
    public static function configured(): bool
    {
        $path = (string) config('services.swaps.private_key_path');

        return config('services.swaps.api_key') && $path !== '' && is_readable($path);
    }

    /** Sign the exact JSON bytes sent to Changelly. Never retry order creation on a transport failure. */
    public static function call(string $method, array $params = []): mixed
    {
        if (! self::configured()) {
            throw new SwapProviderException;
        }
        $body = json_encode(['jsonrpc' => '2.0', 'id' => Qfs::id(), 'method' => $method, 'params' => $params ?: (object) []], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        try {
            $key = openssl_pkey_get_private(file_get_contents(config('services.swaps.private_key_path')));
            $details = $key ? openssl_pkey_get_details($key) : [];
            $signed = $key && ($details['type'] ?? null) === OPENSSL_KEYTYPE_RSA && ($details['bits'] ?? 0) >= 2048
                && openssl_sign($body, $signature, $key, OPENSSL_ALGO_SHA256);
        } catch (\Throwable) {
            throw new SwapProviderException;
        }
        if (! $signed) {
            throw new SwapProviderException;
        }
        try {
            $response = Http::connectTimeout(3)->timeout(12)->withoutRedirecting()
                ->withHeaders(['X-Api-Key' => config('services.swaps.api_key'), 'X-Api-Signature' => base64_encode($signature)])
                ->withBody($body, 'application/json')->post('https://api.changelly.com/v2');
            $reply = $response->json();
        } catch (\Throwable) {
            throw new SwapProviderException;
        }
        if (! $response->successful() || ! is_array($reply) || ($reply['id'] ?? null) !== json_decode($body, true)['id']) {
            throw new SwapProviderException;
        }
        if (isset($reply['error'])) {
            throw new SwapProviderException(($reply['error']['code'] ?? null) === -32602);
        }
        if (! array_key_exists('result', $reply)) {
            throw new SwapProviderException;
        }

        return $reply['result'];
    }

    public static function currencies(bool $fresh = false): array
    {
        $key = 'qfs.swaps.currencies.v1';
        if ($fresh) {
            Cache::forget($key);
        }

        return Cache::remember($key, 30, function () {
            $rows = self::call('getCurrenciesFull');
            if (! is_array($rows) || ! array_is_list($rows)) {
                throw new SwapProviderException;
            }

            return $rows;
        });
    }

    /** Native tickers and token contracts must match the selected main network. */
    public static function matches(string $assetKey, array $currency): bool
    {
        $ticker = strtolower((string) ($currency['ticker'] ?? ''));
        $chain = strtolower((string) ($currency['network'] ?? $currency['blockchain'] ?? ''));
        $token = strtolower((string) ($currency['contractAddress'] ?? ''));
        if (in_array($assetKey, ['BTC', 'ETH', 'XRP', 'SOL'], true)) {
            return $ticker === strtolower($assetKey) && $token === '';
        }
        $chains = $assetKey === 'USDT_BEP20' ? ['bsc', 'bnb', 'binance_smart_chain', 'binance-smart-chain', 'bnb-smart-chain', 'binance smart chain', 'bnb smart chain'] : ['tron', 'trx'];
        $contract = $assetKey === 'USDT_BEP20' ? CryptoAssets::get($assetKey)['token'] : 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

        return in_array($chain, $chains, true) && $token === strtolower($contract);
    }

    public static function routes(bool $fresh = false): array
    {
        $currencies = collect(self::currencies($fresh))->keyBy('ticker');
        $result = [];
        foreach (DB::table('SwapAsset')->where('isActive', true)->get() as $row) {
            $wallet = DB::table('ReceivingWallet')->where('id', $row->walletId)->where('assetKey', $row->assetKey)->where('isActive', true)->first();
            $currency = $currencies->get($row->providerTicker);
            if (! $wallet || ! is_array($currency) || ! self::matches($row->assetKey, $currency) || ! ($currency['enabled'] ?? false) || ! ($currency['fixRateEnabled'] ?? false)) {
                continue;
            }
            $result[$row->assetKey] = [
                'ticker' => $row->providerTicker, 'walletId' => $wallet->id,
                'address' => CryptoAssets::address($row->assetKey, $wallet->address),
                'tag' => CryptoAssets::destinationTag($row->assetKey, $wallet->destinationTag),
                'from' => ($currency['enabledFrom'] ?? false) === true,
                'to' => ($currency['enabledTo'] ?? false) === true,
            ];
        }

        return $result;
    }

    public static function estimate(string $from, string $to, string $quantity): array
    {
        $limits = self::call('getPairsParams', [['from' => $from, 'to' => $to]])[0] ?? null;
        if (! is_array($limits) || ($limits['from'] ?? null) !== $from || ($limits['to'] ?? null) !== $to
            || ! isset($limits['minAmountFixed'], $limits['maxAmountFixed'])) {
            throw new SwapProviderException;
        }
        if (BigDecimal::of($quantity)->isLessThan($limits['minAmountFixed']) || BigDecimal::of($quantity)->isGreaterThan($limits['maxAmountFixed'])) {
            Guard::fail('SWAP_LIMIT', 'The amount is outside the exchange limits for this pair.', 400);
        }
        $rate = self::call('getFixRateForAmount', [['from' => $from, 'to' => $to, 'amountFrom' => $quantity]])[0] ?? null;
        if (! is_array($rate) || ($rate['from'] ?? null) !== $from || ($rate['to'] ?? null) !== $to || empty($rate['id']) || ! is_string($rate['id']) || strlen($rate['id']) > 255
            || ! isset($rate['amountTo'], $rate['networkFee'], $rate['expiredAt'])
            || BigDecimal::of($rate['amountFrom'] ?? '0')->compareTo($quantity) !== 0) {
            throw new SwapProviderException;
        }

        return $rate;
    }

    public static function atomic(string $asset, mixed $quantity): string
    {
        if (! is_string($quantity) || ! preg_match('/^[0-9]{1,18}(\\.[0-9]{1,30})?$/D', $quantity)) {
            throw new SwapProviderException;
        }
        $atomic = BigDecimal::of($quantity)->withPointMovedRight(CryptoAssets::get($asset)['decimals'])->toScale(0, RoundingMode::Floor);
        if ($atomic->isLessThanOrEqualTo(0)) {
            throw new SwapProviderException;
        }

        return (string) $atomic;
    }

    public static function transaction(string $id): array
    {
        $rows = self::call('getTransactions', ['id' => $id]);
        if (! is_array($rows) || count($rows) !== 1 || ($rows[0]['id'] ?? null) !== $id) {
            throw new SwapProviderException;
        }

        return $rows[0];
    }
}
