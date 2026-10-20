<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\Earnings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class CronController
{
    public function accrue(Request $request): JsonResponse
    {
        $secret = (string) config('qfs.cron_secret');
        if ($secret === '') return Api::error('DISABLED', 'CRON_SECRET is not configured', 503);
        $provided = (string) $request->header('x-cron-secret', '');
        if (!hash_equals($secret, $provided)) return Api::error('FORBIDDEN', 'Invalid cron secret', 403);
        $result = Earnings::sweep();
        return Api::ok(['accrued' => $result['credited'], 'totalCents' => $result['totalCents'],
            'usersProcessed' => $result['usersProcessed']]);
    }
}
