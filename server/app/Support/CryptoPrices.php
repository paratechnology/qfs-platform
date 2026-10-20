<?php

namespace App\Support;

use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

final class CryptoPrices
{
    public static function all(): array
    {
        $prices = Cache::remember('qfs.funding.prices.v1', 30, function () {
            try {
                $key = (string) config('qfs.coingecko_demo_key');
                $response = Http::withHeaders($key ? ['x-cg-demo-api-key' => $key] : [])
                    ->connectTimeout(2)->timeout(5)->get('https://api.coingecko.com/api/v3/simple/price', [
                        'ids' => implode(',', array_unique(array_column(CryptoAssets::ALL, 'priceId'))),
                        'vs_currencies' => 'usd', 'include_last_updated_at' => 'true', 'precision' => '12',
                    ]);
                if (! $response->successful()) {
                    return [];
                }
                $out = [];
                foreach (CryptoAssets::ALL as $assetKey => $asset) {
                    $row = $response->json($asset['priceId']) ?? [];
                    if (is_numeric($row['usd'] ?? null) && $row['usd'] > 0 && is_numeric($row['last_updated_at'] ?? null)) {
                        $out[$assetKey] = ['rate' => rtrim(rtrim(sprintf('%.12F', $row['usd']), '0'), '.'), 'timestamp' => (int) $row['last_updated_at']];
                    }
                }

                return $out;
            } catch (\Throwable) {
                return [];
            }
        });

        $prices = self::fresh($prices);
        if (count($prices) < count(CryptoAssets::ALL)) {
            $fallback = Cache::remember('qfs.funding.prices.kraken.v1', 30, fn () => self::kraken());
            $prices += self::fresh($fallback);
        }

        return $prices;
    }

    private static function fresh(array $prices): array
    {
        return array_filter($prices, fn ($price) => abs(now()->timestamp - $price['timestamp']) <= 120 && $price['rate'] !== '0');
    }

    /** Public USD bid/ask midpoint, used only when the primary quote is unavailable. */
    private static function kraken(): array
    {
        $pairs = ['BTC' => 'XXBTZUSD', 'ETH' => 'XETHZUSD', 'USDT' => 'USDTZUSD', 'XRP' => 'XXRPZUSD', 'SOL' => 'SOLUSD'];
        try {
            $response = Http::connectTimeout(2)->timeout(4)->get('https://api.kraken.com/0/public/Ticker', ['pair' => implode(',', $pairs)]);
            $timestamp = strtotime($response->header('Date') ?: '');
            if (! $response->successful() || $response->json('error') !== [] || ! $timestamp
                || abs(now()->timestamp - $timestamp) > 120 || (int) $response->header('age') > 120) {
                return [];
            }
            $out = [];
            foreach (CryptoAssets::ALL as $key => $asset) {
                $row = $response->json('result.'.$pairs[$asset['symbol']]);
                $ask = $row['a'][0] ?? null;
                $bid = $row['b'][0] ?? null;
                if (! is_string($ask) || ! is_string($bid) || strlen($ask) > 50 || strlen($bid) > 50
                    || ! preg_match('/^[0-9]+(?:\.[0-9]+)?$/D', $ask) || ! preg_match('/^[0-9]+(?:\.[0-9]+)?$/D', $bid)) {
                    continue;
                }
                $ask = BigDecimal::of($ask);
                $bid = BigDecimal::of($bid);
                if ($bid->isLessThanOrEqualTo(0) || $ask->isLessThan($bid)) {
                    continue;
                }
                $out[$key] = ['rate' => (string) $bid->plus($ask)->dividedBy(2, 12, RoundingMode::Down), 'timestamp' => $timestamp];
            }

            return $out;
        } catch (\Throwable) {
            return [];
        }
    }

    public static function require(string $key): array
    {
        return self::all()[$key] ?? Guard::fail('PRICE_UNAVAILABLE', 'A fresh crypto price is unavailable. Please try again shortly.', 503);
    }
}
