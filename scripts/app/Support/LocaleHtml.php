<?php

namespace App\Support;

use App\Http\Middleware\SetLanguage;

final class LocaleHtml
{
    /** @var array<string, string> */
    private const DIRECTION = [
        'ar' => 'rtl',
        'ur' => 'rtl',
        'fa' => 'rtl',
    ];

    public static function lang(): string
    {
        return str_replace('_', '-', app()->getLocale());
    }

    public static function dirFor(string $locale): string
    {
        return self::DIRECTION[$locale] ?? 'ltr';
    }

    public static function dir(): string
    {
        return self::dirFor(app()->getLocale());
    }

    public static function abbrFor(string $code): string
    {
        return match ($code) {
            'zh-CN' => 'CN',
            'zh-TW' => 'TW',
            default => str_contains($code, '-') ? explode('-', $code, 2)[0] : $code,
        };
    }

    /** @return list<array{code: string, name: string, abbr: string, direction: string}> */
    public static function languages(): array
    {
        $names = [
            'en' => 'English', 'es' => 'Español', 'fr' => 'Français', 'de' => 'Deutsch', 'it' => 'Italiano',
            'pt' => 'Português', 'nl' => 'Nederlands', 'pl' => 'Polski', 'ru' => 'Русский', 'tr' => 'Türkçe',
            'ar' => 'العربية', 'hi' => 'हिन्दी', 'bn' => 'বাংলা', 'ur' => 'اردو', 'zh-CN' => '简体中文',
            'zh-TW' => '繁體中文', 'ja' => '日本語', 'ko' => '한국어', 'id' => 'Bahasa Indonesia', 'vi' => 'Tiếng Việt', 'th' => 'ไทย',
            'sv' => 'Svenska', 'da' => 'Dansk', 'no' => 'Norsk', 'fi' => 'Suomi', 'cs' => 'Čeština',
            'ro' => 'Română', 'uk' => 'Українська', 'el' => 'Ελληνικά', 'sw' => 'Kiswahili', 'fa' => 'فارسی',
            'ms' => 'Bahasa Melayu', 'fil' => 'Filipino', 'ha' => 'Hausa', 'hu' => 'Magyar',
        ];
        $out = [];
        foreach (SetLanguage::available() as $code) {
            $out[] = [
                'code' => $code,
                'name' => $names[$code] ?? $code,
                'abbr' => self::abbrFor($code),
                'direction' => self::dirFor($code),
            ];
        }

        return $out;
    }
}
