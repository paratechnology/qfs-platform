<?php

namespace App\Support;

use Illuminate\Support\Facades\Lang;
use MessageFormatter;

final class LocalizedText
{
    public static function notification(object $notification): array
    {
        $params = json_decode($notification->messageParams ?? 'null', true);

        return [
            'title' => self::translate($notification->title),
            'body' => is_array($params) && is_string($params['source'] ?? null) && is_array($params['values'] ?? null)
                ? self::translate($params['source'], $params['values']) : self::translate($notification->body ?? null),
        ];
    }

    public static function translate(?string $source, array $values = []): string
    {
        if ($source === null || $source === '') {
            return '';
        }
        $key = 'ui.m'.hash('fnv1a32', $source);
        $message = Lang::has($key) ? (string) __($key) : $source;
        if ($values === []) {
            return $message;
        }

        $formatted = MessageFormatter::formatMessage(app()->getLocale(), $message, $values);

        return $formatted === false ? $source : $formatted;
    }
}
