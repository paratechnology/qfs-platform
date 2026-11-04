<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;

final class Api
{
    public static function ok(mixed $data, int $status = 200): JsonResponse
    {
        return response()->json(['ok' => true, 'data' => $data], $status)
            ->header('Cache-Control', 'no-store');
    }

    public static function error(string $code, string $message, int $status): JsonResponse
    {
        return response()->json(['ok' => false, 'error' => ['code' => $code, 'message' => LocalizedText::translate($message)]], $status)
            ->header('Cache-Control', 'no-store');
    }
}
