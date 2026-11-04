<?php

namespace App\Support;

use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class MailSettings
{
    /** @var list<string> */
    public const SETTING_KEYS = [
        'mail_smtp_host',
        'mail_smtp_port',
        'mail_smtp_encryption',
        'mail_smtp_username',
        'mail_smtp_password',
        'mail_from_address',
        'mail_from_name',
        'mail_account_emails',
    ];

    public static function isManagedKey(string $key): bool
    {
        return str_starts_with($key, 'mail_');
    }

    public static function applyFromDatabase(): void
    {
        $values = Schema::hasTable('Setting')
            ? DB::table('Setting')->whereIn('key', self::SETTING_KEYS)->pluck('value', 'key')->all()
            : [];

        $host = trim((string) ($values['mail_smtp_host'] ?? ''));
        if ($host !== '') {
            self::applySmtpFromStoredValues($values);
        } else {
            self::applySmtpFromEnvironment();
        }

        $fromAddress = trim((string) ($values['mail_from_address'] ?? ''));
        if ($fromAddress === '') {
            $fromAddress = self::envMailString('MAIL_FROM_ADDRESS');
        }
        if ($fromAddress !== '') {
            Config::set('mail.from.address', $fromAddress);
        }

        $fromName = trim((string) ($values['mail_from_name'] ?? ''));
        if ($fromName === '') {
            $fromName = self::envMailString('MAIL_FROM_NAME');
        }
        if ($fromName !== '') {
            Config::set('mail.from.name', $fromName);
        }

        $accountEmails = $values['mail_account_emails'] ?? null;
        if ($accountEmails !== null && $accountEmails !== '') {
            Config::set('qfs.account_emails', self::truthy($accountEmails));
        }
    }

    /** @param array<string, mixed> $values */
    private static function applySmtpFromStoredValues(array $values): void
    {
        $host = trim((string) ($values['mail_smtp_host'] ?? ''));
        if ($host === '') {
            return;
        }
        $port = (int) ($values['mail_smtp_port'] ?? 587);
        if ($port < 1 || $port > 65535) {
            $port = 587;
        }
        $encryption = strtolower(trim((string) ($values['mail_smtp_encryption'] ?? 'tls')));
        if ($encryption === 'none' || $encryption === '') {
            $encryption = null;
        }
        self::configureSmtp(
            $host,
            $port,
            trim((string) ($values['mail_smtp_username'] ?? '')),
            (string) ($values['mail_smtp_password'] ?? ''),
            $encryption,
            null,
        );
    }

    private static function applySmtpFromEnvironment(): void
    {
        $url = self::envMailString('MAIL_URL');
        if ($url !== '') {
            Config::set('mail.default', (string) env('MAIL_MAILER', 'smtp'));
            Config::set('mail.mailers.smtp.url', $url);

            return;
        }

        $host = self::envMailString('MAIL_HOST');
        if ($host === '') {
            return;
        }

        $port = (int) env('MAIL_PORT', 587);
        if ($port < 1 || $port > 65535) {
            $port = 587;
        }
        $scheme = strtolower(self::envMailString('MAIL_SCHEME'));
        $encryption = $scheme === 'smtps' || $port === 465 ? 'ssl' : 'tls';
        if ($scheme === '' || $scheme === 'null') {
            $encryption = $port === 465 ? 'ssl' : null;
        }

        self::configureSmtp(
            $host,
            $port,
            self::envMailString('MAIL_USERNAME'),
            self::envMailString('MAIL_PASSWORD'),
            $encryption,
            $scheme !== '' && $scheme !== 'null' ? $scheme : ($encryption === 'ssl' ? 'smtps' : 'smtp'),
        );
    }

    private static function configureSmtp(
        string $host,
        int $port,
        string $username,
        string $password,
        ?string $encryption,
        ?string $scheme,
    ): void {
        Config::set('mail.default', 'smtp');
        Config::set('mail.mailers.smtp.transport', 'smtp');
        Config::set('mail.mailers.smtp.host', $host);
        Config::set('mail.mailers.smtp.port', $port);
        Config::set('mail.mailers.smtp.username', $username);
        Config::set('mail.mailers.smtp.password', $password);
        Config::set('mail.mailers.smtp.encryption', $encryption);
        Config::set('mail.mailers.smtp.scheme', $scheme ?? ($encryption === 'ssl' ? 'smtps' : 'smtp'));
        Config::set('mail.mailers.smtp.url', null);
    }

    private static function envMailString(string $key): string
    {
        $value = trim((string) env($key, ''));
        if ($value === '' || strtolower($value) === 'null') {
            return '';
        }

        return $value;
    }

    public static function accountEmailsEnabled(): bool
    {
        return (bool) config('qfs.account_emails');
    }

    public static function truthy(string $value): bool
    {
        return in_array(strtolower(trim($value)), ['1', 'true', 'yes', 'on'], true);
    }

    /**
     * @return array<string, string>
     */
    public static function storedValues(): array
    {
        if (! Schema::hasTable('Setting')) {
            return [];
        }

        return DB::table('Setting')->whereIn('key', self::SETTING_KEYS)->pluck('value', 'key')->all();
    }

    public static function upsert(string $key, string $value): void
    {
        DB::table('Setting')->upsert([
            ['key' => $key, 'id' => Qfs::id(), 'value' => $value, 'updatedAt' => Qfs::now()],
        ], ['key'], ['value', 'updatedAt']);
    }
}
