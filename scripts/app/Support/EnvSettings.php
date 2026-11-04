<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

/**
 * Maps .env values into the database-backed settings the app actually reads.
 * Deposit instructions, SMTP, and similar runtime config live in Setting — not in config() alone.
 */
final class EnvSettings
{
    public static function bootstrap(): void
    {
        if (! Schema::hasTable('User') || ! Schema::hasTable('Setting')) {
            return;
        }

        self::syncAdminFromEnv();
        self::syncMailFromEnv();
        self::syncDepositFromEnv();
        self::syncReceivingWalletsFromSettings();
        self::ensureCryptoFeatureSettings();
    }

    private static function envOverridesDatabase(): bool
    {
        return MailSettings::truthy((string) env('QFS_ENV_OVERRIDES_DB', 'false'));
    }

    private static function envString(string $key): string
    {
        $value = trim((string) env($key, ''));
        if ($value === '' || strtolower($value) === 'null') {
            return '';
        }

        return $value;
    }

    private static function settingValue(string $key): string
    {
        return trim((string) (DB::table('Setting')->where('key', $key)->value('value') ?? ''));
    }

    private static function upsertWhenAllowed(string $key, string $value): void
    {
        if ($value === '') {
            return;
        }
        $current = self::settingValue($key);
        if ($current !== '' && ! self::envOverridesDatabase()) {
            return;
        }
        MailSettings::upsert($key, $value);
    }

    private static function syncAdminFromEnv(): void
    {
        if (! app()->environment('local')) {
            return;
        }

        $email = strtolower(self::envString('ADMIN_EMAIL'));
        $password = self::envString('ADMIN_PASSWORD');
        if ($email === '' || strlen($password) < 10) {
            return;
        }

        $user = DB::table('User')->where('email', $email)->first();
        if ($user) {
            if (Hash::check($password, (string) $user->passwordHash)) {
                return;
            }
            DB::table('User')->where('id', $user->id)->update([
                'passwordHash' => Hash::make($password, ['rounds' => 12]),
                'role' => 'ADMIN',
                'status' => 'ACTIVE',
                'updatedAt' => Qfs::now(),
            ]);

            return;
        }

        $id = Qfs::id();
        $code = 'ADMIN'.strtoupper(substr(bin2hex(random_bytes(4)), 0, 6));
        DB::transaction(function () use ($id, $email, $password, $code): void {
            $now = Qfs::now();
            DB::table('User')->insert([
                'id' => $id, 'email' => $email,
                'passwordHash' => Hash::make($password, ['rounds' => 12]),
                'name' => 'QFS Admin', 'role' => 'ADMIN', 'referralCode' => $code,
                'status' => 'ACTIVE', 'updatedAt' => $now,
            ]);
            DB::table('Account')->insert(['id' => Qfs::id(), 'userId' => $id, 'updatedAt' => $now]);
        });
    }

    private static function syncMailFromEnv(): void
    {
        $host = self::envString('MAIL_HOST');
        if ($host === '') {
            return;
        }

        $dbHost = self::settingValue('mail_smtp_host');
        if ($dbHost !== '' && ! self::envOverridesDatabase()) {
            return;
        }

        $port = (int) env('MAIL_PORT', 587);
        if ($port < 1 || $port > 65535) {
            $port = 587;
        }
        $scheme = strtolower(self::envString('MAIL_SCHEME'));
        $encryption = $scheme === 'smtps' || $port === 465 ? 'ssl' : 'tls';

        MailSettings::upsert('mail_smtp_host', $host);
        MailSettings::upsert('mail_smtp_port', (string) $port);
        MailSettings::upsert('mail_smtp_encryption', $encryption);
        MailSettings::upsert('mail_smtp_username', self::envString('MAIL_USERNAME'));
        MailSettings::upsert('mail_smtp_password', self::envString('MAIL_PASSWORD'));

        $from = self::envString('MAIL_FROM_ADDRESS');
        if ($from !== '') {
            MailSettings::upsert('mail_from_address', $from);
        }
        $fromName = self::envString('MAIL_FROM_NAME');
        if ($fromName !== '') {
            MailSettings::upsert('mail_from_name', $fromName);
        }
        MailSettings::upsert(
            'mail_account_emails',
            MailSettings::truthy((string) env('QFS_ACCOUNT_EMAILS', 'false')) ? '1' : '0'
        );
    }

    private static function ensureCryptoFeatureSettings(): void
    {
        if (self::settingValue('crypto_withdrawals_enabled') !== '') {
            return;
        }
        MailSettings::upsert('crypto_withdrawals_enabled', MailSettings::truthy((string) env('QFS_CRYPTO_WITHDRAWALS', 'true')) ? '1' : '0');
    }

    private static function syncReceivingWalletsFromSettings(): void
    {
        $map = [
            'BTC' => 'deposit_btc_address',
            'ETH' => 'deposit_eth_address',
            'USDT_TRC20' => 'deposit_usdt_trc20',
            'USDT_BEP20' => 'deposit_usdt_bep20',
        ];
        $now = Qfs::now();
        foreach ($map as $assetKey => $settingKey) {
            $address = self::settingValue($settingKey);
            if ($address === '') {
                continue;
            }
            try {
                $address = CryptoAssets::address($assetKey, $address);
            } catch (\Throwable) {
                continue;
            }
            if (DB::table('ReceivingWallet')->where('assetKey', $assetKey)->exists()) {
                continue;
            }
            DB::table('ReceivingWallet')->insert([
                'id' => Qfs::id(),
                'assetKey' => $assetKey,
                'label' => 'Platform '.$assetKey,
                'address' => $address,
                'isActive' => true,
                'createdAt' => $now,
                'updatedAt' => $now,
            ]);
        }
    }

    private static function syncDepositFromEnv(): void
    {
        $map = [
            'DEPOSIT_BANK_NAME' => 'deposit_bank_name',
            'DEPOSIT_BANK_ACCOUNT' => 'deposit_bank_account',
            'DEPOSIT_BANK_ACCOUNT_NAME' => 'deposit_bank_account_name',
            'DEPOSIT_BTC_ADDRESS' => 'deposit_btc_address',
            'DEPOSIT_ETH_ADDRESS' => 'deposit_eth_address',
            'DEPOSIT_USDT_TRC20' => 'deposit_usdt_trc20',
            'DEPOSIT_USDT_BEP20' => 'deposit_usdt_bep20',
        ];

        foreach ($map as $envKey => $settingKey) {
            self::upsertWhenAllowed($settingKey, self::envString($envKey));
        }

        $support = self::envString('QFS_SUPPORT_EMAIL');
        if ($support !== '') {
            self::upsertWhenAllowed('support_email', $support);
        }
        $siteName = self::envString('APP_NAME');
        if ($siteName !== '') {
            self::upsertWhenAllowed('site_name', $siteName);
        }
    }
}
