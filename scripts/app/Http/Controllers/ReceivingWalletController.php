<?php

namespace App\Http\Controllers;

use App\Support\AdminLog;
use App\Support\Api;
use App\Support\CryptoAssets;
use App\Support\Guard;
use App\Support\Qfs;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class ReceivingWalletController
{
    public function index(Request $request): JsonResponse
    {
        Guard::admin($request);

        return Api::ok(['assets' => CryptoAssets::ALL, 'wallets' => DB::table('ReceivingWallet')->orderByDesc('createdAt')->get()]);
    }

    public function save(Request $request, ?string $id = null): JsonResponse
    {
        $admin = Guard::admin($request);
        $data = $request->validate($id ? ['label' => 'sometimes|required|string|min:2|max:80', 'isActive' => 'sometimes|boolean',
            'assetKey' => 'prohibited', 'address' => 'sometimes|required|string|max:120', 'destinationTag' => 'sometimes|nullable|string|max:10']
            : ['assetKey' => 'required|string|max:30', 'label' => 'required|string|min:2|max:80', 'address' => 'required|string|max:120', 'destinationTag' => 'nullable|string|max:10']);
        if (! $id) {
            $data['address'] = CryptoAssets::address($data['assetKey'], $data['address']);
            $data['destinationTag'] = CryptoAssets::destinationTag($data['assetKey'], $data['destinationTag'] ?? null);
            if (DB::table('ReceivingWallet')->count() >= 100) {
                Guard::fail('LIMIT', 'The receiving wallet limit has been reached.', 400);
            }
        }
        try {
            $row = DB::transaction(function () use ($admin, $data, $id) {
                $previous = $id ? DB::table('ReceivingWallet')->where('id', $id)->lockForUpdate()->first() : null;
                if ($id && ! $previous) {
                    Guard::fail('NOT_FOUND', 'Receiving wallet not found.', 404);
                }
                $key = $id ?: Qfs::id();
                if ($id) {
                    if (array_key_exists('address', $data)) {
                        $data['address'] = CryptoAssets::address($previous->assetKey, $data['address']);
                    }
                    if (array_key_exists('destinationTag', $data)) {
                        $data['destinationTag'] = CryptoAssets::destinationTag($previous->assetKey, $data['destinationTag']);
                    }
                    DB::table('ReceivingWallet')->where('id', $id)->update([...$data, 'updatedAt' => Qfs::now()]);
                } else {
                    DB::table('ReceivingWallet')->insert(['id' => $key, ...$data]);
                }
                AdminLog::audit($admin->id, $id ? 'RECEIVING_WALLET.UPDATE' : 'RECEIVING_WALLET.CREATE', 'ReceivingWallet', $key,
                    ['before' => $previous ? array_intersect_key((array) $previous, $data) : null, 'after' => $data]);

                return DB::table('ReceivingWallet')->where('id', $key)->first();
            });
        } catch (QueryException $error) {
            if ($error instanceof UniqueConstraintViolationException) {
                Guard::fail('CONFLICT', 'This receiving wallet already exists.', 409);
            }
            throw $error;
        }

        $row->isActive = (bool) $row->isActive;

        return Api::ok($row);
    }
}
