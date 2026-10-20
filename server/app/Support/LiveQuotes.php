<?php

namespace App\Support;

use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

final class LiveQuotes
{
    private const CRYPTO_IDS = [
        'BTC' => 'bitcoin', 'ETH' => 'ethereum', 'XRP' => 'ripple', 'SOL' => 'solana',
        'DOGE' => 'dogecoin', 'ADA' => 'cardano', 'LTC' => 'litecoin', 'BNB' => 'binancecoin',
    ];

    private const TICKERS = [
        'XAU' => 'GC=F', 'XAG' => 'SI=F', 'XPT' => 'PL=F', 'XPD' => 'PA=F', 'XCU' => 'HG=F',
        'SPX' => '^GSPC', 'IXIC' => '^IXIC', 'DJI' => '^DJI',
        'AAPL' => 'AAPL', 'TSLA' => 'TSLA', 'NVDA' => 'NVDA', 'MSFT' => 'MSFT', 'AMZN' => 'AMZN',
        'BTC' => 'BTC-USD', 'ETH' => 'ETH-USD', 'XRP' => 'XRP-USD', 'SOL' => 'SOL-USD',
        'DOGE' => 'DOGE-USD', 'ADA' => 'ADA-USD', 'LTC' => 'LTC-USD', 'BNB' => 'BNB-USD',
    ];

    private static function quote(float $price, float $pct): array
    {
        $digits = abs($price) >= 100 ? 2 : (abs($price) >= 1 ? 4 : 5);

        return [
            'price' => number_format($price, $digits),
            'chg' => sprintf('%+.2f%%', $pct), 'up' => $pct >= 0,
            'priceValue' => $price, 'changePct' => $pct, 'digits' => $digits,
        ];
    }

    public static function all(): array
    {
        $quotes = Cache::remember('qfs.liveQuotes', 60, function () {
            $quotes = [];
            try {
                $responses = Http::pool(function (Pool $pool) {
                    $requests = [];
                    $key = (string) config('qfs.coingecko_demo_key');
                    $headers = $key !== '' ? ['x-cg-demo-api-key' => $key] : [];
                    $requests['coingecko'] = $pool->as('coingecko')->withHeaders($headers)->timeout(5)
                        ->get('https://api.coingecko.com/api/v3/simple/price', [
                            'ids' => implode(',', self::CRYPTO_IDS), 'vs_currencies' => 'usd',
                            'include_24hr_change' => 'true', 'include_last_updated_at' => 'true',
                        ]);
                    foreach (self::TICKERS as $symbol => $ticker) {
                        $requests[$symbol] = $pool->as($symbol)->withHeaders([
                            'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
                            'Accept' => 'application/json',
                        ])->timeout(5)->get(
                            'https://query1.finance.yahoo.com/v8/finance/chart/'.rawurlencode($ticker),
                            ['interval' => '1d', 'range' => '5d']
                        );
                    }

                    return $requests;
                });
                foreach ($responses as $symbol => $response) {
                    if ($symbol === 'coingecko') {
                        continue;
                    }
                    if (! $response instanceof Response || ! $response->successful()) {
                        continue;
                    }
                    $meta = $response->json('chart.result.0.meta') ?? [];
                    $price = $meta['regularMarketPrice'] ?? null;
                    if (! is_numeric($price)) {
                        continue;
                    }
                    $pct = $meta['regularMarketChangePercent'] ?? null;
                    $previous = $meta['chartPreviousClose'] ?? null;
                    if (! is_numeric($pct)) {
                        $pct = is_numeric($previous) && (float) $previous !== 0.0
                            ? (($price - $previous) / $previous) * 100 : 0;
                    }
                    $quotes[$symbol] = self::quote((float) $price, (float) $pct);
                }
                $crypto = $responses['coingecko'] ?? null;
                if ($crypto instanceof Response && $crypto->successful()) {
                    $data = $crypto->json();
                    foreach (self::CRYPTO_IDS as $symbol => $id) {
                        $row = $data[$id] ?? [];
                        $price = $row['usd'] ?? null;
                        $pct = $row['usd_24h_change'] ?? null;
                        $updated = $row['last_updated_at'] ?? null;
                        if (! is_numeric($price) || ! is_numeric($pct) || ! is_numeric($updated)
                            || abs(time() - (int) $updated) > 600) {
                            continue;
                        }
                        $quotes[$symbol] = self::quote((float) $price, (float) $pct);
                    }
                }
            } catch (\Throwable) {
                // Keep the admin-managed database quote when upstream is unavailable.
            }

            return $quotes;
        });

        return array_map(function (array $quote): array {
            if (isset($quote['priceValue'], $quote['changePct'], $quote['digits'])) {
                $quote['price'] = Qfs::number($quote['priceValue'], $quote['digits']);
                $quote['chg'] = ($quote['changePct'] >= 0 ? '+' : '').Qfs::number($quote['changePct'], 2).'%';
            }
            unset($quote['priceValue'], $quote['changePct'], $quote['digits']);

            return $quote;
        }, $quotes);
    }
}
