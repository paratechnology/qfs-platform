<?php

namespace App\Support;

use Illuminate\Support\Str;

final class Qfs
{
    public static function id(): string
    {
        return (string) Str::ulid();
    }

    public static function now(): string
    {
        return now()->toDateTimeString();
    }

    public static function money(int|float $cents, int $precision = 2): string
    {
        if (app()->getLocale() === 'en') {
            return '$'.number_format($cents / 100, $precision);
        }
        $formatter = new \NumberFormatter(app()->getLocale(), \NumberFormatter::CURRENCY);
        $formatter->setAttribute(\NumberFormatter::MIN_FRACTION_DIGITS, $precision);
        $formatter->setAttribute(\NumberFormatter::MAX_FRACTION_DIGITS, $precision);

        return $formatter->formatCurrency($cents / 100, 'USD') ?: '$'.number_format($cents / 100, $precision);
    }

    public static function number(int|float $value, int $precision = 0): string
    {
        if (app()->getLocale() === 'en') {
            return number_format($value, $precision);
        }
        $formatter = new \NumberFormatter(app()->getLocale(), \NumberFormatter::DECIMAL);
        $formatter->setAttribute(\NumberFormatter::MIN_FRACTION_DIGITS, $precision);
        $formatter->setAttribute(\NumberFormatter::MAX_FRACTION_DIGITS, $precision);

        return $formatter->format($value) ?: number_format($value, $precision);
    }

    public static function cents(mixed $amount): ?int
    {
        if (! is_numeric($amount)) {
            return null;
        }
        $value = (float) $amount;
        if (! is_finite($value) || $value <= 0 || $value > 1_000_000) {
            return null;
        }
        $cents = (int) round($value * 100);

        return abs($value * 100 - $cents) < 0.000001 ? $cents : null;
    }

    public static function reference(string $prefix): string
    {
        return $prefix.'-'.strtoupper(Str::random(12));
    }
}
