<?php

namespace App\Http\Controllers;

use App\Mail\PasswordRecoveryMail;
use App\Support\AccountEmail;
use App\Support\AdminLog;
use App\Support\Api;
use App\Support\Guard;
use App\Support\Qfs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Throwable;

use function Illuminate\Support\defer;

final class PasswordRecoveryController
{
    private function throttle(string $key, int $attempts): void
    {
        if (RateLimiter::tooManyAttempts($key, $attempts)) {
            Guard::fail('TOO_MANY_REQUESTS', 'Too many attempts. Please wait a minute and try again.', 429);
        }
        RateLimiter::hit($key, 60);
    }

    private function deliveryAvailable(?string $mailer = null, array $visited = []): bool
    {
        return AccountEmail::deliveryAvailable($mailer, $visited);
    }

    public function requestLink(Request $request): JsonResponse
    {
        $this->throttle('recovery:ip:'.$request->ip(), 5);
        $data = $request->validate(['email' => 'required|string|email|max:200']);
        $email = strtolower(trim($data['email']));
        $this->throttle('recovery:email:'.hash('sha256', $email), 1);
        $base = rtrim((string) config('qfs.public_url'), '/');
        $scheme = parse_url($base, PHP_URL_SCHEME);
        $host = parse_url($base, PHP_URL_HOST);
        if (! $this->deliveryAvailable() || ! $host || ($scheme !== 'https' && ! ($scheme === 'http' && app()->environment(['local', 'testing']) && in_array($host, ['localhost', '127.0.0.1'], true)))) {
            Guard::fail('RECOVERY_UNAVAILABLE', 'Email recovery is temporarily unavailable. Please contact support.', 503);
        }
        $locale = app()->getLocale();
        defer(function () use ($email, $base, $locale) {
            $issued = DB::transaction(function () use ($email) {
                $user = DB::table('User')->where('email', $email)->lockForUpdate()->first();
                if (! $user || $user->status !== 'ACTIVE') {
                    return null;
                }
                $token = bin2hex(random_bytes(32));
                $hash = hash('sha256', $token);
                DB::table('PasswordRecoveryToken')->updateOrInsert(['userId' => $user->id], [
                    'tokenHash' => $hash, 'expiresAt' => now()->addMinutes(30), 'createdAt' => Qfs::now(),
                ]);

                return [$user, $token, $hash];
            });
            if (! $issued) {
                return;
            }
            [$user, $token, $hash] = $issued;
            try {
                Mail::to($user->email)->send((new PasswordRecoveryMail($user->name, $base.'/reset-password#token='.$token))->locale($user->locale ?? $locale));
            } catch (Throwable $error) {
                DB::table('PasswordRecoveryToken')->where('userId', $user->id)->where('tokenHash', $hash)->delete();
                Log::error('Password recovery email delivery failed.', ['exception' => get_class($error)]);
            }
        });

        return Api::ok(['message' => 'If an active account matches this email, look for a password reset link. If it does not arrive, try again or contact support.']);
    }

    public function reset(Request $request): JsonResponse
    {
        $this->throttle('recovery:reset:'.$request->ip(), 10);
        $data = $request->validate([
            'token' => 'required|string|regex:/^[a-f0-9]{64}$/',
            'password' => ['required', 'string', 'min:10', 'max:72', 'regex:/[A-Za-z]/', 'regex:/[0-9]/'],
            'confirmPassword' => 'required|same:password',
        ]);
        if (strlen($data['password']) > 72) {
            Guard::fail('BAD_REQUEST', 'Password is too long (72 bytes maximum).', 400);
        }
        $hash = hash('sha256', $data['token']);
        $user = DB::transaction(function () use ($hash, $data) {
            $owner = DB::table('PasswordRecoveryToken')->where('tokenHash', $hash)->value('userId');
            $user = $owner ? DB::table('User')->where('id', $owner)->lockForUpdate()->first() : null;
            $record = $user ? DB::table('PasswordRecoveryToken')->where('userId', $user->id)->lockForUpdate()->first() : null;
            if (! $user || $user->status !== 'ACTIVE' || ! $record || ! hash_equals($record->tokenHash, $hash) || now()->greaterThanOrEqualTo($record->expiresAt)) {
                Guard::fail('INVALID_RESET_LINK', 'This recovery link is invalid or expired. Request a new link.', 400);
            }
            DB::table('User')->where('id', $user->id)->update(['passwordHash' => Hash::make($data['password'], ['rounds' => 12]), 'updatedAt' => Qfs::now()]);
            DB::table('Session')->where('userId', $user->id)->delete();
            DB::table('PasswordRecoveryToken')->where('userId', $user->id)->delete();
            AdminLog::notify($user->id, 'Account password changed', 'Your password was reset and existing sessions were signed out. Contact support if this was not you.');

            return $user;
        });
        if ($this->deliveryAvailable()) {
            $locale = app()->getLocale();
            defer(function () use ($user, $locale) {
                try {
                    Mail::to($user->email)->send((new PasswordRecoveryMail($user->name))->locale($user->locale ?? $locale));
                } catch (Throwable $error) {
                    Log::error('Password change notification delivery failed.', ['exception' => get_class($error)]);
                }
            });
        }

        return Api::ok(['message' => 'Your password has been changed. Sign in with your new password.'])
            ->cookie('qfs_session', '', -1, '/', null, app()->environment('production'), true, false, 'lax');
    }
}
