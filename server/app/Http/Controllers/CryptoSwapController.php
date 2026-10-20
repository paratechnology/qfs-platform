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
        $routes = [];
        $available = CryptoSwaps::enabled();
        if ($available) {
            try {
                $routes = SwapProvider::routes();
            } catch (SwapProviderException) {
                $available = false;
            }
        }

        return Api::ok([
            'available' => $available && count($routes) >= 2,
            'assets' => array_map(fn ($key, $row) => ['assetKey' => $key, 'from' => $row['from'], 'to' => $row['to']], array_keys($routes), array_values($routes)),
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
        CryptoSwaps::create($swap->id);
        SwapTreasury::tick($swap->id);

        return Api::ok(CryptoSwaps::describe(DB::table('CryptoSwap')->where('id', $swap->id)->first()));
    }
}
