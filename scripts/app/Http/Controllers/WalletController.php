<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\Guard;
use App\Support\Qfs;
use App\Support\WalletCrypto;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Validator;

final class WalletController
{
    public function index(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $wallets = DB::table('WalletConnection')->where('userId', $user->id)
            ->orderByDesc('lastUsedAt')->get(['address', 'chainId', 'label', 'lastUsedAt']);

        return Api::ok(['wallets' => $wallets]);
    }

    public function challenge(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $data = Validator::make($request->all(), ['address' => 'required|string|max:42'])->validate();
        $address = WalletCrypto::address(trim($data['address']));
        if (! $address) {
            Guard::fail('ADDRESS', 'That is not a valid Ethereum address.', 400);
        }
        $key = 'wallet:challenge:'.$user->id;
        if (RateLimiter::tooManyAttempts($key, 10)) {
            Guard::fail('TOO_MANY_REQUESTS', 'Wait before requesting another signing message.', 429);
        }
        RateLimiter::hit($key, 60);

        $nonce = bin2hex(random_bytes(16));
        $allowedOrigins = array_filter(array_map('trim', explode(',', (string) config('qfs.allowed_origins'))));
        $requestOrigin = (string) $request->header('Origin');
        $origin = $requestOrigin && in_array($requestOrigin, $allowedOrigins, true)
            ? $requestOrigin
            : (rtrim((string) config('qfs.public_url'), '/') ?: $request->getSchemeAndHttpHost());
        $message = implode("\n", [
            $origin.' wants you to connect your wallet:', '', $address, '',
            'This does not trigger a blockchain transaction or cost any gas.', '',
            'URI: '.$origin, 'Version: 1', 'Nonce: '.$nonce,
            'Issued At: '.now()->toIso8601String(),
        ]);
        DB::table('WalletNonce')->insert([
            'id' => Qfs::id(), 'userId' => $user->id, 'nonce' => $nonce,
            'message' => $message, 'expiresAt' => now()->addMinutes(10),
        ]);
        DB::table('WalletNonce')->where('expiresAt', '<', now())->delete();

        return Api::ok(['nonce' => $nonce, 'message' => $message, 'chainIds' => [1, 56]]);
    }

    public function verify(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $data = Validator::make($request->all(), [
            'address' => 'required|string|max:42',
            'signature' => ['required', 'string', 'regex:/^0x[0-9a-fA-F]{130}$/'],
            'nonce' => ['required', 'string', 'regex:/^[0-9a-f]{32}$/'],
            'chainId' => 'required|integer|in:1,56',
            'label' => 'sometimes|string|max:40',
        ])->validate();
        $address = WalletCrypto::address(trim($data['address']));
        if (! $address) {
            Guard::fail('ADDRESS', 'That is not a valid Ethereum address.', 400);
        }

        // Consume once, including failed signatures, so no challenge can be replayed.
        $challenge = DB::transaction(function () use ($user, $data) {
            $row = DB::table('WalletNonce')->where('userId', $user->id)
                ->where('nonce', $data['nonce'])->lockForUpdate()->first();
            if (! $row) {
                return null;
            }
            DB::table('WalletNonce')->where('id', $row->id)->delete();

            return $row;
        });
        if (! $challenge || strtotime($challenge->expiresAt) < time()) {
            Guard::fail('NONCE', 'Signing request expired. Please try again.', 400);
        }
        $lines = explode("\n", $challenge->message);
        if (($lines[2] ?? null) !== $address) {
            Guard::fail('SIGNATURE', 'Signing message does not match this address.', 400);
        }
        $recovered = WalletCrypto::recoveredAddress($challenge->message, $data['signature']);
        if (! $recovered || ! hash_equals(strtolower($address), strtolower($recovered))) {
            Guard::fail('SIGNATURE', 'Signature verification failed.', 400);
        }

        $existing = DB::table('WalletConnection')->where('userId', $user->id)->where('address', $address)->first();
        if ($existing) {
            DB::table('WalletConnection')->where('id', $existing->id)->update(['chainId' => (int) $data['chainId'], 'lastUsedAt' => Qfs::now()]);
        } else {
            DB::table('WalletConnection')->insert([
                'id' => Qfs::id(), 'userId' => $user->id, 'address' => $address,
                'chainId' => (int) $data['chainId'], 'label' => trim($data['label'] ?? ''), 'lastUsedAt' => Qfs::now(),
            ]);
        }
        DB::table('AuditLog')->insert([
            'id' => Qfs::id(), 'actorId' => $user->id, 'actorRole' => 'USER',
            'action' => 'WALLET_CONNECT', 'targetType' => 'Wallet', 'targetId' => $address,
            'meta' => json_encode(['chainId' => (int) $data['chainId'], 'alreadyConnected' => (bool) $existing]),
        ]);

        return Api::ok(['address' => $address, 'chainId' => (int) $data['chainId'], 'alreadyConnected' => (bool) $existing]);
    }

    public function disconnect(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $data = Validator::make($request->all(), ['address' => 'required|string|max:42'])->validate();
        $address = WalletCrypto::address(trim($data['address']));
        if (! $address) {
            Guard::fail('ADDRESS', 'That is not a valid Ethereum address.', 400);
        }
        $deleted = DB::table('WalletConnection')->where('userId', $user->id)->where('address', $address)->delete();
        if (! $deleted) {
            Guard::fail('NOT_FOUND', 'Wallet not found.', 404);
        }
        DB::table('AuditLog')->insert([
            'id' => Qfs::id(), 'actorId' => $user->id, 'actorRole' => 'USER',
            'action' => 'WALLET_DISCONNECT', 'targetType' => 'Wallet', 'targetId' => $address,
        ]);

        return Api::ok(['disconnected' => true, 'address' => $address]);
    }
}
