<?php

namespace Tests\Feature;

use App\Support\CryptoPrices;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class CryptoPricesTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
    }

    private function ticker(): array
    {
        return ['error' => [], 'result' => [
            'XXBTZUSD' => ['a' => ['100002'], 'b' => ['100000']],
            'XETHZUSD' => ['a' => ['2002'], 'b' => ['2000']],
            'USDTZUSD' => ['a' => ['0.996'], 'b' => ['0.994']],
            'XXRPZUSD' => ['a' => ['2.02'], 'b' => ['2']],
            'SOLUSD' => ['a' => ['151'], 'b' => ['150']],
        ]];
    }

    public function test_fresh_primary_quotes_remain_preferred_while_missing_assets_use_the_fallback(): void
    {
        Http::fake([
            'api.coingecko.com/*' => Http::response(['ethereum' => ['usd' => 2100, 'last_updated_at' => now()->timestamp]]),
            'api.kraken.com/*' => Http::response($this->ticker(), 200, ['Date' => now()->toRfc7231String()]),
        ]);
        $prices = CryptoPrices::all();
        $this->assertCount(6, $prices);
        $this->assertSame('2100', $prices['ETH']['rate']);
        $this->assertSame('0.995000000000', $prices['USDT_TRC20']['rate']);
        $this->assertSame($prices['USDT_TRC20'], $prices['USDT_BEP20']);
        CryptoPrices::all();
        Http::assertSentCount(2);
    }

    public function test_primary_outage_uses_fresh_market_data_instead_of_assuming_stablecoin_parity(): void
    {
        Http::fake([
            'api.coingecko.com/*' => Http::response([], 429),
            'api.kraken.com/*' => Http::response($this->ticker(), 200, ['Date' => now()->toRfc7231String()]),
        ]);
        $this->assertSame('0.995000000000', CryptoPrices::require('USDT_TRC20')['rate']);
        $this->assertSame('2001.000000000000', CryptoPrices::require('ETH')['rate']);
        Http::assertSentCount(2);
    }

    public function test_stale_cached_primary_prices_are_replaced_by_a_fresh_fallback(): void
    {
        Cache::put('qfs.funding.prices.v1', ['ETH' => ['rate' => '1000', 'timestamp' => now()->subMinutes(5)->timestamp]], 30);
        Http::fake(['api.kraken.com/*' => Http::response($this->ticker(), 200, ['Date' => now()->toRfc7231String()])]);
        $this->assertSame('2001.000000000000', CryptoPrices::require('ETH')['rate']);
    }

    public function test_stale_or_invalid_backup_data_cannot_be_used_for_financial_quotes(): void
    {
        Http::fake([
            'api.coingecko.com/*' => Http::response([], 503),
            'api.kraken.com/*' => fn () => Http::response($this->ticker(), 200, ['Date' => config('test.fallbackDate', now()->subMinutes(5)->toRfc7231String()), 'Age' => config('test.fallbackAge', '0')]),
        ]);
        $this->assertSame([], CryptoPrices::all());
        Cache::forget('qfs.funding.prices.kraken.v1');
        config()->set('test.fallbackDate', now()->toRfc7231String());
        config()->set('test.fallbackAge', '200');
        $this->assertSame([], CryptoPrices::all());
    }

    public function test_invalid_market_rows_are_ignored_and_provider_failures_keep_prices_unavailable(): void
    {
        $ticker = $this->ticker();
        $ticker['result']['USDTZUSD'] = ['a' => ['1'], 'b' => ['0']];
        $ticker['result']['XETHZUSD'] = ['a' => ['1000'], 'b' => ['2000']];
        Http::fake([
            'api.coingecko.com/*' => Http::response([], 503),
            'api.kraken.com/*' => Http::response($ticker, 200, ['Date' => now()->toRfc7231String()]),
        ]);
        $prices = CryptoPrices::all();
        $this->assertArrayNotHasKey('USDT_TRC20', $prices);
        $this->assertArrayNotHasKey('USDT_BEP20', $prices);
        $this->assertArrayNotHasKey('ETH', $prices);
        $this->assertArrayHasKey('BTC', $prices);
    }
}
