<?php

namespace App\Support;

use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;

final class Guard
{
    public static function user(Request $request): object
    {
        $user = SessionAuth::user($request);
        if (!$user) self::fail('UNAUTHORIZED', 'Please log in to continue.', 401);
        return $user;
    }

    public static function admin(Request $request): object
    {
        $user = self::user($request);
        if ($user->role !== 'ADMIN') self::fail('FORBIDDEN', 'You do not have access to this action.', 403);
        return $user;
    }

    public static function fail(string $code, string $message, int $status): never
    {
        throw new HttpResponseException(Api::error($code, $message, $status));
    }
}
