<?php

namespace App\Http\Controllers;

use App\Support\AdminLog;
use App\Support\Api;
use App\Support\CryptoAssets;
use App\Support\CryptoSwaps;
use App\Support\Guard;
use App\Support\Qfs;
use App\Support\SwapProvider;
use App\Support\SwapProviderException;
use App\Support\SwapTreasury;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class AdminSwapController
{
    public function configuration(Request $request): JsonResponse
    {
        Guard::admin($request);
        $currencies = [];
        $providerAvailable = false;
        if (SwapProvider::configured()) {
            try {
                foreach (SwapProvider::currencies() as $currency) {
                    foreach (array_keys(CryptoAssets::ALL) as $asset) {
                        if (SwapProvider::matches($asset, $currency)) {
                            $currencies[] = ['assetKey' => $asset, 'ticker' => $currency['ticker'], 'enabled' => (bool) ($currency['enabled'] ?? false)];
                        }
                    }
                }
                $providerAvailable = true;
            } catch (SwapProviderException) {
                // Configuration remains accessible during a provider outage.
            }
        }

        return Api::ok([
            'enabled' => (bool) config('services.swaps.enabled'), 'credentialsConfigured' => SwapProvider::configured(),
            'providerAvailable' => $providerAvailable, 'automaticFunding' => SwapTreasury::automatic(), 'assets' => CryptoAssets::ALL,
            'wallets' => DB::table('ReceivingWallet')->where('isActive', true)->get(),
            'routes' => DB::table('SwapAsset')->get(), 'currencies' => $currencies,
        ]);
    }

    public function saveConfiguration(Request $request): JsonResponse
    {
        $admin = Guard::admin($request);
        $data = $request->validate(['assetKey' => 'required|string|max:30', 'walletId' => 'required|string|max:64',
            'providerTicker' => 'required|string|max:40', 'isActive' => 'required|boolean']);
        CryptoAssets::get($data['assetKey']);
        $wallet = DB::table('ReceivingWallet')->where('id', $data['walletId'])->where('assetKey', $data['assetKey'])->first();
        if (! $wallet || ($data['isActive'] && ! $wallet->isActive)) {
            Guard::fail('SWAP_WALLET', 'Choose an active receiving wallet on the matching network.', 400);
        }
        if ($data['isActive']) {
            $currency = collect(SwapProvider::currencies(true))->firstWhere('ticker', $data['providerTicker']);
            if (! is_array($currency) || ! SwapProvider::matches($data['assetKey'], $currency) || ! ($currency['enabled'] ?? false) || ! ($currency['fixRateEnabled'] ?? false)) {
                Guard::fail('SWAP_PAIR', 'The provider does not support this asset on the selected network.', 400);
            }
        }
        DB::transaction(function () use ($data, $admin) {
            DB::table('SwapAsset')->updateOrInsert(['assetKey' => $data['assetKey']], [...$data, 'updatedAt' => Qfs::now()]);
            AdminLog::audit($admin->id, 'SWAP.ROUTE_UPDATE', 'SwapAsset', $data['assetKey'], $data);
        });

        return Api::ok(['saved' => true]);
    }

    public function index(Request $request): JsonResponse
    {
        Guard::admin($request);
        $query = DB::table('CryptoSwap')->orderByDesc('createdAt');
        if ($request->query('pending') === '1') {
            $query->whereNotIn('status', CryptoSwaps::TERMINAL);
        }
        $items = $query->limit(100)->get()->map(function ($row) {
            $user = DB::table('User')->where('id', $row->userId)->first();

            return [...CryptoSwaps::describe($row, true), 'userEmail' => $user->email ?? '', 'userName' => $user->name ?? ''];
        });

        return Api::ok(['items' => $items, 'automaticFunding' => SwapTreasury::automatic()]);
    }

    public function action(Request $request, string $id): JsonResponse
    {
        $admin = Guard::admin($request);
        $data = $request->validate([
            'action' => 'required|in:REFRESH,BEGIN_FUNDING,RECORD_FUNDING,RECOVER,REFUND,RELEASE_UNFUNDED',
            'txHash' => 'nullable|string|max:100', 'providerId' => 'nullable|string|max:100',
            'quantity' => 'nullable|string|max:40', 'verified' => 'nullable|boolean',
        ]);
        $row = DB::table('CryptoSwap')->where('id', $id)->first();
        if (! $row) {
            Guard::fail('NOT_FOUND', 'Swap not found.', 404);
        }
        switch ($data['action']) {
            case 'RELEASE_UNFUNDED':
                CryptoSwaps::releaseVerifiedUnfunded($id, $admin->id, ($data['verified'] ?? false) === true);
                break;
            case 'REFRESH':
                CryptoSwaps::sync($id);
                break;
            case 'RECOVER':
                if ($row->providerId || empty($data['providerId'])) {
                    Guard::fail('CONFLICT', 'This swap can no longer be changed.', 409);
                }
                CryptoSwaps::attach($id, SwapProvider::transaction($data['providerId']));
                AdminLog::audit($admin->id, 'SWAP.RECOVER', 'CryptoSwap', $id, ['providerId' => $data['providerId']]);
                CryptoSwaps::sync($id);
                break;
            case 'BEGIN_FUNDING':
                if (SwapTreasury::automatic()) {
                    Guard::fail('SWAP_FUNDING', 'Automatic treasury funding is enabled. Reconcile the existing transfer instead.', 409);
                }
                CryptoSwaps::sync($id);
                SwapTreasury::begin($id, $admin->id);
                break;
            case 'RECORD_FUNDING':
                SwapTreasury::record($id, $data['txHash'] ?? '', $admin->id);
                CryptoSwaps::sync($id);
                break;
            case 'REFUND':
                if (($data['verified'] ?? false) !== true) {
                    Guard::fail('REFUND', 'Verify the refund transaction and returned quantity before continuing.', 400);
                }
                CryptoSwaps::refund($id, $data['quantity'] ?? '', $admin->id);
                break;
        }

        return Api::ok(CryptoSwaps::describe(DB::table('CryptoSwap')->where('id', $id)->first(), true));
    }
}
