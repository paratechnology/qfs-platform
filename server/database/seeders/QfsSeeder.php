<?php

namespace Database\Seeders;

use App\Support\Qfs;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

final class QfsSeeder extends Seeder
{
    public function run(): void
    {
        // Fill missing reference rows only. Existing accounts and admin edits are preserved.
        $now = Qfs::now();
        foreach ([
            ['QFS Starter', 10_000, 4_999_900, 1000, 3, 1, 'Entry plan for new investors.'],
            ['QFS Growth', 5_000_000, 49_999_900, 2500, 6, 2, 'Six-month plan with hourly profit payouts.'],
            ['QFS Premium', 50_000_000, 100_000_000, 3500, 12, 3, 'Maximum returns, long-term horizon.'],
        ] as [$name, $minimum, $maximum, $roi, $term, $sort, $description]) {
            if (! DB::table('InvestmentPlan')->where('name', $name)->exists()) {
                DB::table('InvestmentPlan')->insert([
                    'id' => Qfs::id(), 'name' => $name, 'description' => $description,
                    'minAmountCents' => $minimum, 'maxAmountCents' => $maximum,
                    'monthlyRoiBps' => $roi, 'payoutInterval' => 'HOURLY',
                    'termMonths' => $term, 'sort' => $sort, 'updatedAt' => $now,
                ]);
            }
        }
        foreach ([
            ['XAU', 'Gold', 'Gold / USD', 'METAL', '2,394.50', '+0.82%', 'up', '#D4AF37', 1],
            ['XAG', 'Silver', 'Silver / USD', 'METAL', '28.94', '+1.14%', 'up', '#9EA7B3', 2],
            ['XPT', 'Platinum', 'Platinum / USD', 'METAL', '1,012.00', '-0.31%', 'down', '#A6B9C8', 3],
            ['XPD', 'Palladium', 'Palladium / USD', 'METAL', '1,089.40', '+0.42%', 'up', '#B3665C', 4],
            ['XCU', 'Copper', 'Copper / USD', 'METAL', '4.521', '+0.63%', 'up', '#B87333', 5],
            ['SPX', 'S&P 500', 'Index', 'STOCK', '5,428.12', '+0.41%', 'up', '#4DA3FF', 1],
            ['IXIC', 'NASDAQ', 'Index', 'STOCK', '17,612.50', '+0.72%', 'up', '#4DA3FF', 2],
            ['DJI', 'Dow Jones', 'Index', 'STOCK', '39,218.34', '-0.12%', 'down', '#4DA3FF', 3],
            ['AAPL', 'Apple Inc.', 'Technology', 'STOCK', '214.29', '+1.22%', 'up', '#A2AAAD', 4],
            ['TSLA', 'Tesla Inc.', 'Automotive', 'STOCK', '248.50', '+2.01%', 'up', '#E82127', 5],
            ['NVDA', 'NVIDIA Corp.', 'Semiconductors', 'STOCK', '131.20', '+1.85%', 'up', '#76B900', 6],
            ['MSFT', 'Microsoft', 'Technology', 'STOCK', '448.10', '+0.34%', 'up', '#00A4EF', 7],
            ['AMZN', 'Amazon.com', 'E-commerce', 'STOCK', '186.44', '-0.52%', 'down', '#FF9900', 8],
            ['BTC', 'Bitcoin', 'BTC / USD', 'CRYPTO', '64,280', '+2.4%', 'up', '#F7931A', 1],
            ['ETH', 'Ethereum', 'ETH / USD', 'CRYPTO', '3,412', '+1.8%', 'up', '#627EEA', 2],
            ['XRP', 'XRP', 'XRP / USD', 'CRYPTO', '0.5234', '+0.9%', 'up', '#23292F', 3],
            ['SOL', 'Solana', 'SOL / USD', 'CRYPTO', '148.20', '+3.1%', 'up', '#9945FF', 4],
            ['DOGE', 'Dogecoin', 'DOGE / USD', 'CRYPTO', '0.124', '+4.2%', 'up', '#C2A633', 5],
            ['ADA', 'Cardano', 'ADA / USD', 'CRYPTO', '0.449', '+1.2%', 'up', '#0033AD', 6],
            ['LTC', 'Litecoin', 'LTC / USD', 'CRYPTO', '84.90', '+0.6%', 'up', '#345D9D', 7],
            ['BNB', 'BNB', 'BNB / USD', 'CRYPTO', '587.00', '+0.4%', 'up', '#F0B90B', 8],
        ] as [$symbol, $name, $full, $type, $price, $change, $direction, $color, $sort]) {
            if (! DB::table('MarketAsset')->where('symbol', $symbol)->exists()) {
                DB::table('MarketAsset')->insert(compact('symbol', 'name', 'full', 'type', 'price', 'change', 'direction', 'color', 'sort')
                    + ['id' => Qfs::id()]);
            }
        }
        foreach ([
            'site_name' => 'QFS', 'support_email' => 'support@qfs.local',
            'referral_rate_bps' => '500', 'min_withdrawal_cents' => '5000',
            'deposit_bank_name' => '', 'deposit_bank_account' => '',
            'deposit_bank_account_name' => '', 'deposit_btc_address' => '',
            'deposit_eth_address' => '', 'deposit_usdt_trc20' => '', 'deposit_usdt_bep20' => '',
        ] as $key => $value) {
            if (! DB::table('Setting')->where('key', $key)->exists()) {
                DB::table('Setting')->insert(['id' => Qfs::id(), 'key' => $key, 'value' => $value, 'updatedAt' => $now]);
            }
        }
        $email = strtolower(trim((string) env('ADMIN_EMAIL', '')));
        $password = (string) env('ADMIN_PASSWORD', '');
        if ($email && strlen($password) >= 10 && ! DB::table('User')->where('email', $email)->exists()) {
            $id = Qfs::id();
            $code = 'ADMIN'.strtoupper(substr(bin2hex(random_bytes(4)), 0, 6));
            DB::transaction(function () use ($id, $email, $password, $code, $now) {
                DB::table('User')->insert([
                    'id' => $id, 'email' => $email,
                    'passwordHash' => password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]),
                    'name' => 'QFS Admin', 'role' => 'ADMIN', 'referralCode' => $code,
                    'updatedAt' => $now,
                ]);
                DB::table('Account')->insert(['id' => Qfs::id(), 'userId' => $id, 'updatedAt' => $now]);
            });
        }
    }
}
