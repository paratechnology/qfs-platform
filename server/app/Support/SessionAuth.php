<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class SessionAuth
{
    public static function devUser(Request $request): ?array
    {
        if (! app()->environment('local') || ! config('qfs.dev_login')) {
            return null;
        }
        $token = $request->cookie('qfs_session');
        if (! $token || ! preg_match('/^dev\.(\d{13})\.([0-9a-f]{32})\.([0-9a-f]{64})$/', $token, $parts)) {
            return null;
        }
        if ((int) $parts[1] < (int) round(microtime(true) * 1000)) {
            return null;
        }
        $payload = 'dev.'.$parts[1].'.'.$parts[2];
        if (! hash_equals(hash_hmac('sha256', $payload, self::secret()), $parts[3])) {
            return null;
        }

        return [
            'id' => 'qfs-local-dev-preview',
            'email' => (string) config('qfs.dev_login_email'),
            'name' => 'Local Demo',
            'role' => 'USER',
            'status' => 'ACTIVE',
            'avatarUrl' => '/avatars/avatar1.jpg',
            'country' => 'Local preview',
            'referralCode' => 'DEMO',
            'memberSince' => now()->toISOString(),
            'kycLevel' => 0,
        ];
    }

    private static function secret(): string
    {
        $secret = (string) config('qfs.session_secret');
        if (strlen($secret) < 32) {
            throw new \RuntimeException('QFS_SESSION_SECRET must contain at least 32 characters');
        }

        return $secret;
    }

    public static function tokenHash(string $token): string
    {
        return hash_hmac('sha256', $token, self::secret());
    }

    public static function user(Request $request): ?object
    {
        $token = $request->cookie('qfs_session');
        if (! $token || str_starts_with($token, 'dev.')) {
            return null;
        }
        $session = DB::table('Session')->where('tokenHash', self::tokenHash($token))->first();
        if (! $session) {
            return null;
        }
        if (strtotime($session->expiresAt) < now()->timestamp) {
            DB::table('Session')->where('id', $session->id)->delete();

            return null;
        }
        $user = DB::table('User')->where('id', $session->userId)->first();

        if ($user && $user->status === 'ACTIVE') {
            $request->attributes->set('qfs_session_id', $session->id);
            if (property_exists($session, 'lastSeenAt') && (! $session->lastSeenAt || strtotime($session->lastSeenAt) < now()->subMinutes(5)->timestamp)) {
                DB::table('Session')->where('id', $session->id)->update(['lastSeenAt' => Qfs::now()]);
            }

            return $user;
        }

        return null;
    }

    public static function issue(string $userId, ?Request $request = null): string
    {
        $token = bin2hex(random_bytes(32));
        DB::table('Session')->insert([
            'id' => Qfs::id(), 'userId' => $userId,
            'tokenHash' => self::tokenHash($token),
            'expiresAt' => now()->addDays(7), 'createdAt' => now(),
            ...($request ? ['ipAddress' => $request->ip(), 'userAgent' => mb_substr($request->userAgent() ?? '', 0, 500), 'lastSeenAt' => Qfs::now()] : []),
        ]);

        return $token;
    }

    public static function revoke(Request $request): void
    {
        $token = $request->cookie('qfs_session');
        if ($token && ! str_starts_with($token, 'dev.')) {
            DB::table('Session')->where('tokenHash', self::tokenHash($token))->delete();
        }
    }

    public static function publicUser(object $user): array
    {
        return [
            'id' => $user->id, 'email' => $user->email, 'name' => $user->name,
            'role' => $user->role, 'status' => $user->status,
            'avatarUrl' => $user->avatarUrl, 'country' => $user->country,
            'referralCode' => $user->referralCode, 'memberSince' => $user->memberSince,
            'kycLevel' => $user->kycLevel,
            'locale' => $user->locale ?? null,
            'phone' => $user->phone ?? null,
        ];
    }
}
