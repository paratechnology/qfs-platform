<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

final class SwapTreasury
{
    public static function automatic(): bool
    {
        return str_starts_with((string) config('services.swaps.treasury_url'), 'https://')
            && (string) config('services.swaps.treasury_token') !== '';
    }

    /** Persist the attempt before a signer or an administrator can send money. */
    public static function begin(string $id, ?string $adminId = null): object
    {
        $swap = DB::table('CryptoSwap')->where('id', $id)->first();

        return DB::transaction(function () use ($swap, $adminId) {
            CryptoSwaps::account($swap->userId);
            $row = DB::table('CryptoSwap')->where('id', $swap->id)->lockForUpdate()->first();
            if (! CryptoSwaps::enabled() || $row->status !== 'AWAITING_FUNDING' || $row->fundingAttemptAt || ! $row->providerId
                || ! $row->payTill || now()->addSeconds(20)->greaterThanOrEqualTo($row->payTill)) {
                Guard::fail('SWAP_FUNDING', 'This swap is not available for treasury funding.', 409);
            }
            DB::table('CryptoSwap')->where('id', $row->id)->update(['fundingAttemptAt' => Qfs::now(), 'status' => 'FUNDING', 'updatedAt' => Qfs::now()]);
            if ($adminId) {
                AdminLog::audit($adminId, 'SWAP.FUNDING_BEGIN', 'CryptoSwap', $row->id);
            }

            return DB::table('CryptoSwap')->where('id', $row->id)->first();
        });
    }

    public static function record(string $id, string $hash, ?string $adminId = null): void
    {
        $swap = DB::table('CryptoSwap')->where('id', $id)->first();
        $key = CryptoAssets::txKey($swap->fromAsset, $hash);
        DB::transaction(function () use ($swap, $hash, $key, $adminId) {
            CryptoSwaps::account($swap->userId);
            $row = DB::table('CryptoSwap')->where('id', $swap->id)->lockForUpdate()->first();
            if ($row->payinTxKey === $key) {
                return;
            }
            if (! $row->fundingAttemptAt || $row->payinTxKey || in_array($row->status, CryptoSwaps::TERMINAL, true)) {
                Guard::fail('CONFLICT', 'This swap can no longer be changed.', 409);
            }
            DB::table('CryptoSwap')->where('id', $row->id)->update([
                'payinHash' => CryptoAssets::hash($row->fromAsset, $hash), 'payinTxKey' => $key,
                'status' => 'PROCESSING', 'lastError' => null, 'updatedAt' => Qfs::now(),
            ]);
            if ($adminId) {
                AdminLog::audit($adminId, 'SWAP.FUNDING_RECORD', 'CryptoSwap', $row->id, ['txHash' => $hash]);
            }
        });
    }

    /** The external signer implements an idempotent transfer resource; GET reconciles uncertain PUT responses. */
    public static function tick(string $id): void
    {
        if (! self::automatic()) {
            return;
        }
        $swap = DB::table('CryptoSwap')->where('id', $id)->first();
        if (! $swap || $swap->payinHash || in_array($swap->status, CryptoSwaps::TERMINAL, true) || ! $swap->providerId) {
            return;
        }
        $new = ! $swap->fundingAttemptAt;
        try {
            if ($new) {
                if ($swap->status !== 'AWAITING_FUNDING' || ! CryptoSwaps::enabled()) {
                    return;
                }
                $swap = self::begin($id);
            }
            $base = rtrim(config('services.swaps.treasury_url'), '/');
            $client = Http::withToken(config('services.swaps.treasury_token'))->acceptJson()->connectTimeout(3)->timeout(12)->withoutRedirecting();
            $routing = json_decode($swap->routing, true);
            $payload = [
                'idempotencyKey' => $swap->id, 'assetKey' => $swap->fromAsset, 'quantityAtomic' => $swap->fromAtomic,
                'fromAddress' => $routing['from']['address'], 'address' => $swap->payinAddress, 'destinationTag' => $swap->payinTag,
                'expiresAt' => $swap->payTill, 'provider' => 'changelly', 'providerId' => $swap->providerId,
            ];
            $response = $new ? $client->withHeaders(['Idempotency-Key' => $swap->id])->put($base.'/transfers/'.rawurlencode($swap->id), $payload)
                : $client->get($base.'/transfers/'.rawurlencode($swap->id));
            if (! $response->successful()) {
                throw new SwapProviderException;
            }
            $reply = $response->json();
            foreach (['idempotencyKey', 'assetKey', 'quantityAtomic', 'address', 'destinationTag'] as $field) {
                if (($reply[$field] ?? null) !== $payload[$field]) {
                    throw new SwapProviderException;
                }
            }
            if (in_array($reply['status'] ?? '', ['SUBMITTED', 'CONFIRMED'], true)) {
                self::record($id, $reply['txHash'] ?? '');
            } elseif (($reply['status'] ?? '') === 'NOT_SENT' && empty($reply['txHash'])) {
                DB::transaction(function () use ($swap) {
                    CryptoSwaps::account($swap->userId);
                    $row = DB::table('CryptoSwap')->where('id', $swap->id)->lockForUpdate()->first();
                    if (! $row->payinHash && ! in_array($row->status, CryptoSwaps::TERMINAL, true)) {
                        DB::table('CryptoSwap')->where('id', $swap->id)->update(['fundingAttemptAt' => null]);
                        CryptoSwaps::attention($swap->id, 'Treasury confirmed no payment was sent. Waiting for the exchange order to expire.');
                    }
                });
            } elseif (($reply['status'] ?? '') !== 'PENDING') {
                throw new SwapProviderException;
            }
        } catch (\Throwable) {
            CryptoSwaps::attention($id, 'Treasury funding needs reconciliation. Check the existing transfer before sending again.');
        }
    }
}
