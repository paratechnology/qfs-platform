<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\Earnings;
use App\Support\Guard;
use App\Support\InvestmentLifecycle;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class InvestmentLifecycleController
{
    public function history(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        Earnings::forUser($user->id);
        $limit = 10;
        $query = DB::table('Investment')->join('InvestmentPlan', 'Investment.planId', '=', 'InvestmentPlan.id')
            ->where('Investment.userId', $user->id)->whereIn('Investment.status', ['MATURED', 'CLOSED']);
        if ($cursor = $request->query('cursor')) {
            $anchor = DB::table('Investment')->where('id', $cursor)->where('userId', $user->id)->first();
            if (! $anchor) {
                Guard::fail('BAD_REQUEST', 'Invalid investment history cursor.', 400);
            }
            $query->where(fn ($q) => $q->where('Investment.createdAt', '<', $anchor->createdAt)
                ->orWhere(fn ($q) => $q->where('Investment.createdAt', $anchor->createdAt)->where('Investment.id', '<', $anchor->id)));
        }
        $rows = $query->orderByDesc('Investment.createdAt')->orderByDesc('Investment.id')->limit($limit + 1)
            ->select('Investment.*', 'InvestmentPlan.name as planName')->get();

        return Api::ok(['items' => $rows->take($limit)->map(fn ($row) => Earnings::describe($row))->values(),
            'nextCursor' => $rows->count() > $limit ? $rows[$limit - 1]->id : null]);
    }

    public function queue(Request $request): JsonResponse
    {
        Guard::admin($request);
        $rows = DB::table('Investment')->join('User', 'User.id', '=', 'Investment.userId')
            ->join('InvestmentPlan', 'InvestmentPlan.id', '=', 'Investment.planId')
            ->where('Investment.status', 'MATURED')->whereNull('Investment.principalReturnedAt')
            ->orderBy('Investment.maturedAt')
            ->select('Investment.*', 'User.name as userName', 'User.email as userEmail', 'InvestmentPlan.name as planName')->get();

        return Api::ok($rows);
    }

    public function release(Request $request, string $id): JsonResponse
    {
        $admin = Guard::admin($request);
        $request->validate(['action' => 'required|in:RELEASE_PRINCIPAL']);

        return Api::ok(InvestmentLifecycle::release($id, $admin->id));
    }
}
