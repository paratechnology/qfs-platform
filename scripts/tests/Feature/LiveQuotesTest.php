<?php

namespace Tests\Feature;

use App\Support\LiveQuotes;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class LiveQuotesTest extends TestCase
{
    public function test_crypto_batch_supplies_all_prices_when_yahoo_fails(): void
    {
        Cache::forget('qfs.liveQuotes');
        $ids = ['bitcoin', 'ethereum', 'ripple', 'solana', 'dogecoin', 'cardano', 'litecoin', 'binancecoin'];
        $data = [];
        foreach ($ids as $id) {
            $data[$id] = ['usd' => 100, 'usd_24h_change' => 1.25, 'last_updated_at' => time()];
        }
        Http::fake([
            'api.coingecko.com/*' => Http::response($data),
            '*' => Http::response([], 503),
        ]);
        $quotes = LiveQuotes::all();
        $this->assertCount(8, $quotes);
        $this->assertSame('100.00', $quotes['BTC']['price']);
        $this->assertSame('+1.25%', $quotes['BNB']['chg']);
        Http::assertSentCount(22);
    }

    public function test_quote_cache_keeps_original_values_while_each_language_formats_its_response(): void
    {
        Cache::forget('qfs.liveQuotes');
        Http::fake(['api.coingecko.com/*' => Http::response(['bitcoin' => ['usd' => 1000.5, 'usd_24h_change' => -1.25, 'last_updated_at' => time()]]),
            '*' => Http::response([], 503)]);
        app()->setLocale('es');
        $spanish = LiveQuotes::all();
        $this->assertSame('1.000,50', $spanish['BTC']['price']);
        $this->assertSame('-1,25%', $spanish['BTC']['chg']);
        $this->assertFalse($spanish['BTC']['up']);
        $cached = Cache::get('qfs.liveQuotes');
        $this->assertSame(1000.5, $cached['BTC']['priceValue']);
        app()->setLocale('en');
        $english = LiveQuotes::all();
        $this->assertSame('1,000.50', $english['BTC']['price']);
        $this->assertSame('-1.25%', $english['BTC']['chg']);
        $this->assertArrayNotHasKey('priceValue', $english['BTC']);
        $this->assertSame($cached, Cache::get('qfs.liveQuotes'));
        Http::assertSentCount(22);
    }
}
