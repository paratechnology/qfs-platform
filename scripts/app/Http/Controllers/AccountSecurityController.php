<?php

namespace App\Http\Controllers;

use App\Support\AdminLog;
use App\Support\Api;
use App\Support\Guard;
use App\Support\Qfs;
use App\Support\SessionAuth;
use App\Support\TwoFactor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

final class AccountSecurityController
{
    public function show(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $security = DB::table('AccountSecurity')->where('userId', $user->id)->first();
        $sessions = DB::table('Session')->where('userId', $user->id)->where('expiresAt', '>', Qfs::now())
            ->orderByDesc('lastSeenAt')->orderByDesc('createdAt')->get()->map(fn ($row) => [
                'id' => $row->id, 'current' => $row->id === $request->attributes->get('qfs_session_id'),
                'ipAddress' => $row->ipAddress, 'userAgent' => $row->userAgent,
                'createdAt' => $row->createdAt, 'lastSeenAt' => $row->lastSeenAt, 'expiresAt' => $row->expiresAt,
            ]);

        return Api::ok(['user' => SessionAuth::publicUser($user), 'sessions' => $sessions,
            'twoFactorEnabled' => (bool) $security?->enabledAt,
            'recoveryCodesRemaining' => count(json_decode($security?->recoveryHashes ?? '[]', true))]);
    }

    public function profile(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $request->merge(array_map(fn ($value) => is_string($value) ? trim($value) : $value, $request->only('name', 'phone', 'country')));
        $data = $request->validate(['name' => 'required|string|min:2|max:120', 'country' => 'required|string|min:2|max:80',
            'phone' => ['nullable', 'string', 'min:7', 'max:24', 'regex:/^[+()\-\s\d]+$/']]);
        DB::table('User')->where('id', $user->id)->update([...$data, 'updatedAt' => Qfs::now()]);

        return Api::ok(SessionAuth::publicUser(DB::table('User')->where('id', $user->id)->first()));
    }

    /** Call within a transaction, after locking User. */
    private function authorizeChange(Request $request, object $user, bool $factor = true): ?object
    {
        if ($user->status !== 'ACTIVE' || ! DB::table('Session')->where('id', $request->attributes->get('qfs_session_id'))->where('userId', $user->id)->where('expiresAt', '>', Qfs::now())->exists()) {
            Guard::fail('UNAUTHORIZED', 'Please log in to continue.', 401);
        }
        if (! Hash::check((string) $request->input('currentPassword'), $user->passwordHash)) {
            Guard::fail('INVALID_PASSWORD', 'Your current password is incorrect.', 400);
        }
        $security = DB::table('AccountSecurity')->where('userId', $user->id)->lockForUpdate()->first();
        if ($factor && $security?->enabledAt && ! TwoFactor::verify($security, (string) $request->input('code'))) {
            Guard::fail('INVALID_CODE', 'Enter a new authenticator code or an unused recovery code.', 400);
        }

        return $security;
    }

    private function otherSessions(Request $request, string $userId): int
    {
        return DB::table('Session')->where('userId', $userId)
            ->where('id', '!=', $request->attributes->get('qfs_session_id'))->delete();
    }

    public function password(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $data = $request->validate(['currentPassword' => 'required|string|max:200',
            'password' => ['required', 'string', 'min:10', 'max:72', 'regex:/[A-Za-z]/', 'regex:/[0-9]/', 'different:currentPassword'],
            'confirmPassword' => 'required|same:password', 'code' => 'nullable|string|max:30']);
        if (strlen($data['password']) > 72) {
            Guard::fail('BAD_REQUEST', 'Password is too long (72 bytes maximum)', 400);
        }
        DB::transaction(function () use ($request, $user, $data) {
            $locked = DB::table('User')->where('id', $user->id)->lockForUpdate()->first();
            $this->authorizeChange($request, $locked);
            DB::table('User')->where('id', $user->id)->update(['passwordHash' => Hash::make($data['password']), 'updatedAt' => Qfs::now()]);
            $this->otherSessions($request, $user->id);
            DB::table('PasswordRecoveryToken')->where('userId', $user->id)->delete();
            DB::table('LoginChallenge')->where('userId', $user->id)->delete();
            DB::table('AccountSecurity')->where('userId', $user->id)->update(['pendingSecret' => null, 'pendingSessionId' => null, 'pendingExpiresAt' => null]);
            AdminLog::notify($user->id, 'Account password changed', 'Your password was changed and other sessions were signed out.');
        });

        return Api::ok(['changed' => true]);
    }

    public function revoke(Request $request, string $id): JsonResponse
    {
        $user = Guard::user($request);
        $request->validate(['currentPassword' => 'required|string|max:200', 'code' => 'nullable|string|max:30']);
        if ($id === $request->attributes->get('qfs_session_id')) {
            Guard::fail('BAD_REQUEST', 'Use Sign out to end your current session.', 400);
        }
        $count = DB::transaction(function () use ($request, $user, $id) {
            $locked = DB::table('User')->where('id', $user->id)->lockForUpdate()->first();
            $this->authorizeChange($request, $locked);
            $query = DB::table('Session')->where('userId', $user->id)->where('id', '!=', $request->attributes->get('qfs_session_id'));
            if ($id !== 'others') {
                $query->where('id', $id);
            }

            return $query->delete();
        });

        return Api::ok(['revoked' => $count]);
    }

    public function setup(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $request->validate(['currentPassword' => 'required|string|max:200']);
        $secret = DB::transaction(function () use ($request, $user) {
            $locked = DB::table('User')->where('id', $user->id)->lockForUpdate()->first();
            $security = $this->authorizeChange($request, $locked, false);
            if ($security?->enabledAt) {
                Guard::fail('CONFLICT', 'Two-factor authentication is already enabled.', 409);
            }
            $secret = TwoFactor::generateSecret();
            DB::table('AccountSecurity')->updateOrInsert(['userId' => $user->id], [
                'pendingSecret' => Crypt::encryptString($secret), 'pendingSessionId' => $request->attributes->get('qfs_session_id'),
                'pendingExpiresAt' => now()->addMinutes(10),
            ]);

            return $secret;
        });
        $uri = 'otpauth://totp/'.rawurlencode('QFS:'.$user->email).'?'.http_build_query([
            'secret' => $secret, 'issuer' => 'QFS', 'algorithm' => 'SHA1', 'digits' => 6, 'period' => 30,
        ], '', '&', PHP_QUERY_RFC3986);

        return Api::ok(['secret' => $secret, 'uri' => $uri]);
    }

    public function factor(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $data = $request->validate(['action' => 'required|in:ENABLE,DISABLE,RECOVERY_CODES',
            'currentPassword' => 'required|string|max:200', 'code' => 'required|string|max:30']);
        $codes = DB::transaction(function () use ($request, $user, $data) {
            $locked = DB::table('User')->where('id', $user->id)->lockForUpdate()->first();
            $security = $this->authorizeChange($request, $locked, $data['action'] !== 'ENABLE');
            if ($data['action'] === 'ENABLE') {
                if ($security?->enabledAt || ! $security?->pendingSecret || $security->pendingSessionId !== $request->attributes->get('qfs_session_id') || now()->greaterThanOrEqualTo($security->pendingExpiresAt)) {
                    Guard::fail('CONFLICT', 'Authenticator setup expired. Start setup again.', 409);
                }
                $counter = TwoFactor::counter(Crypt::decryptString($security->pendingSecret), $data['code']);
                if ($counter === null) {
                    Guard::fail('INVALID_CODE', 'The authenticator code is incorrect.', 400);
                }
                $codes = TwoFactor::recoveryCodes();
                DB::table('AccountSecurity')->where('userId', $user->id)->update([
                    'secret' => $security->pendingSecret, 'enabledAt' => Qfs::now(), 'lastCounter' => $counter,
                    'recoveryHashes' => TwoFactor::recoveryHashes($codes),
                    'pendingSecret' => null, 'pendingSessionId' => null, 'pendingExpiresAt' => null,
                ]);
            } else {
                if (! $security?->enabledAt) {
                    Guard::fail('CONFLICT', 'Two-factor authentication is not enabled.', 409);
                }
                $codes = $data['action'] === 'RECOVERY_CODES' ? TwoFactor::recoveryCodes() : [];
                DB::table('AccountSecurity')->where('userId', $user->id)->update($data['action'] === 'DISABLE'
                    ? ['secret' => null, 'enabledAt' => null, 'recoveryHashes' => null, 'lastCounter' => -1]
                    : ['recoveryHashes' => TwoFactor::recoveryHashes($codes)]);
            }
            $this->otherSessions($request, $user->id);
            DB::table('LoginChallenge')->where('userId', $user->id)->delete();
            if ($user->role === 'ADMIN') {
                AdminLog::audit($user->id, 'SECURITY.'.$data['action'], 'User', $user->id);
            }
            AdminLog::notify($user->id, 'Account security updated', 'Your two-factor authentication settings changed. Other sessions were signed out.');

            return $codes;
        });

        return Api::ok(['recoveryCodes' => $codes]);
    }
}
