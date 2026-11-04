<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\CryptoSwaps;
use App\Support\Guard;
use App\Support\SwapProvider;
use App\Support\SwapProviderException;
use App\Support\SwapTreasury;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class CryptoSwapController
{
    public function index(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $provider = false;
        if (CryptoSwaps::enabled()) {
            try {
                $provider = count(SwapProvider::routes()) >= 2;
            } catch (SwapProviderException) {
                $provider = false;
            }
        }

        return Api::ok([
            'available' => true,
            'internal' => true,
            'provider' => $provider,
            'assets' => CryptoSwaps::catalog(),
            'items' => DB::table('CryptoSwap')->where('userId', $user->id)->orderByDesc('createdAt')->limit(30)->get()->map(fn ($row) => CryptoSwaps::describe($row)),
        ]);
    }

    public function quote(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $data = $request->validate(['fromAsset' => 'required|string|max:30', 'toAsset' => 'required|string|max:30', 'quantity' => 'required|string|max:40']);

        return Api::ok(CryptoSwaps::estimate($user->id, $data['fromAsset'], $data['toAsset'], $data['quantity']));
    }

    public function store(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $data = $request->validate(['quoteId' => 'required|string|max:64', 'reference' => 'required|string|min:4|max:80']);
        $swap = CryptoSwaps::reserve($user->id, $data['quoteId'], $data['reference']);
        if (! CryptoSwaps::isInternal($swap)) {
            CryptoSwaps::create($swap->id);
            SwapTreasury::tick($swap->id);
        }

        return Api::ok(CryptoSwaps::describe(DB::table('CryptoSwap')->where('id', $swap->id)->first()));
    }
}
