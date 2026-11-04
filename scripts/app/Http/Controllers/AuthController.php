<?php

namespace App\Http\Controllers;

use App\Http\Middleware\SetLanguage;
use App\Support\AdminLog;
use App\Support\Api;
use App\Support\Guard;
use App\Support\Qfs;
use App\Support\SessionAuth;
use App\Support\TwoFactor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

final class AuthController
{
    private function throttle(string $key, int $attempts, int $decaySeconds): ?JsonResponse
    {
        if (RateLimiter::tooManyAttempts($key, $attempts)) {
            return Api::error('TOO_MANY_REQUESTS', 'Too many requests. Please try again later.', 429);
        }
        RateLimiter::hit($key, $decaySeconds);

        return null;
    }

    private function cookie(JsonResponse $response, string $token, ?string $locale = null): JsonResponse
    {
        $response->cookie('qfs_session', $token, 7 * 24 * 60, '/', null,
            app()->environment('production'), true, false, 'lax');
        if (! in_array(request()->cookie('qfs_locale'), SetLanguage::available(), true) && in_array($locale, SetLanguage::available(), true)) {
            $response->cookie('qfs_locale', $locale, 365 * 24 * 60, '/', null, app()->environment('production'), true, false, 'lax');
        }

        return $response;
    }

    public function checkEmail(Request $request): JsonResponse
    {
        if ($error = $this->throttle('email:'.$request->ip(), 30, 60)) {
            return $error;
        }
        $email = strtolower(trim((string) $request->query('email', '')));
        if (! filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 200) {
            return Api::ok(['available' => true]);
        }

        return Api::ok(['available' => ! DB::table('User')->where('email', $email)->exists()]);
    }

    public function register(Request $request): JsonResponse
    {
        if ($error = $this->throttle('register:'.$request->ip(), 10, 60)) {
            return $error;
        }
        $input = $request->all();
        $validator = Validator::make($input, [
            'firstName' => ['required', 'string', 'min:2', 'max:60'],
            'lastName' => ['required', 'string', 'min:2', 'max:60'],
            'email' => ['required', 'email', 'max:200'],
            'password' => ['required', 'string', 'min:10', 'max:72', 'regex:/[A-Za-z]/', 'regex:/[0-9]/'],
            'confirmPassword' => ['required', 'same:password'],
            'country' => ['nullable', 'string', 'max:80'],
            'phone' => ['required', 'string', 'min:7', 'max:24', 'regex:/^[+()\\-\\s\\d]+$/'],
            'referralCode' => ['sometimes', 'string', 'max:20'],
        ]);
        if ($validator->fails()) {
            return Api::error('BAD_REQUEST', $validator->errors()->first(), 400);
        }
        if (strlen($input['password']) > 72) {
            return Api::error('BAD_REQUEST', 'Password is too long (72 bytes maximum)', 400);
        }

        $email = strtolower(trim($input['email']));
        if ($error = $this->throttle('register:email:'.$email, 3, 600)) {
            return $error;
        }
        if (DB::table('User')->where('email', $email)->exists()) {
            return Api::error('CONFLICT', 'An account with this email already exists.', 409);
        }
        $name = preg_replace('/\s+/', ' ', trim($input['firstName']).' '.trim($input['lastName']));
        $base = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $input['firstName']));
        $referrerId = isset($input['referralCode'])
            ? DB::table('User')->where('referralCode', strtoupper(trim($input['referralCode'])))->value('id') : null;
        $user = DB::transaction(function () use ($input, $email, $name, $base, $referrerId) {
            $now = Qfs::now();
            $id = Qfs::id();
            do {
                $referral = substr($base, 0, 5).strtoupper(Str::random(6));
            } while (DB::table('User')->where('referralCode', $referral)->exists());
            DB::table('User')->insert([
                'id' => $id, 'email' => $email,
                'passwordHash' => Hash::make($input['password'], ['rounds' => 12]),
                'name' => $name, 'phone' => trim($input['phone']),
                'locale' => app()->getLocale(),
                'country' => trim($input['country'] ?? '') ?: 'United States',
                'referralCode' => $referral, 'referredById' => $referrerId, 'updatedAt' => $now,
            ]);
            DB::table('Account')->insert(['id' => Qfs::id(), 'userId' => $id, 'updatedAt' => $now]);

            return DB::table('User')->where('id', $id)->first();
        });
        SessionAuth::revoke($request);
        AdminLog::notify($user->id, 'Account registration successful.', 'Sign in with your email address and password to access your account.');

        return Api::ok(['registered' => true, 'user' => $this->authResponse($user)])
            ->cookie('qfs_session', '', -1, '/', null, app()->environment('production'), true, false, 'lax');
    }

    public function login(Request $request): JsonResponse
    {
        if ($error = $this->throttle('login:'.$request->ip(), 15, 60)) {
            return $error;
        }
        $validator = Validator::make($request->all(), [
            'email' => ['required', 'email', 'max:200'],
            'password' => ['required', 'string', 'max:200'],
        ]);
        if ($validator->fails()) {
            return Api::error('BAD_REQUEST', $validator->errors()->first(), 400);
        }
        $email = strtolower(trim($request->input('email')));
        if ($error = $this->throttle('login:email:'.$email, 10, 60)) {
            return $error;
        }
        if (app()->environment('local') && config('qfs.dev_login') &&
            $email === strtolower(trim((string) config('qfs.dev_login_email')))) {
            $expected = (string) config('qfs.dev_login_password');
            if ($expected === '' || ! hash_equals($expected, $request->input('password'))) {
                return Api::error('UNAUTHORIZED', 'Invalid email or password', 401);
            }
            $expires = (int) round(microtime(true) * 1000) + 12 * 60 * 60 * 1000;
            $payload = 'dev.'.$expires.'.'.bin2hex(random_bytes(16));
            $signature = hash_hmac('sha256', $payload, (string) config('qfs.session_secret'));
            $token = $payload.'.'.$signature;

            return Api::ok(['user' => [
                'id' => 'qfs-local-dev-preview', 'name' => 'Local Demo', 'email' => $email,
                'role' => 'USER', 'referralCode' => 'DEMO',
            ]])->cookie('qfs_session', $token, 12 * 60, '/', null, false, true, false, 'lax');
        }
        [$user, $token] = DB::transaction(function () use ($email, $request) {
            $user = DB::table('User')->where('email', $email)->lockForUpdate()->first();
            $dummy = '$2b$12$6qnBXsNWMbuc2xr.d8Be.ue6wgcQ4isW0r3k2pa1NKcDc8GYuvtq2';
            if (! Hash::check($request->input('password'), $user?->passwordHash ?? $dummy) || ! $user) {
                Guard::fail('UNAUTHORIZED', 'Invalid email or password', 401);
            }
            if ($user->status === 'SUSPENDED') {
                Guard::fail('SUSPENDED', 'This account has been suspended. Contact support.', 403);
            }
            DB::table('User')->where('id', $user->id)->update(['lastLoginAt' => Qfs::now()]);

            $security = DB::table('AccountSecurity')->where('userId', $user->id)->first();
            if ($security?->enabledAt) {
                DB::table('LoginChallenge')->where('expiresAt', '<=', Qfs::now())->delete();
                DB::table('LoginChallenge')->where('userId', $user->id)->delete();
                $challenge = bin2hex(random_bytes(32));
                DB::table('LoginChallenge')->insert(['tokenHash' => hash('sha256', $challenge), 'userId' => $user->id,
                    'passwordFingerprint' => hash('sha256', $user->passwordHash), 'expiresAt' => now()->addMinutes(5)]);

                return [$user, ['twoFactorRequired' => true, 'challenge' => $challenge]];
            }

            return [$user, SessionAuth::issue($user->id, $request)];
        });

        if (is_array($token)) {
            return Api::ok($token);
        }

        return $this->cookie(Api::ok(['user' => $this->authResponse($user)]), $token, $user->locale ?? null);
    }

    public function verifyFactor(Request $request): JsonResponse
    {
        $data = $request->validate(['challenge' => 'required|string|size:64', 'code' => 'required|string|max:30']);
        if ($error = $this->throttle('two-factor:'.$request->ip(), 15, 60)) {
            return $error;
        }
        $result = DB::transaction(function () use ($data, $request) {
            $hash = hash('sha256', $data['challenge']);
            $owner = DB::table('LoginChallenge')->where('tokenHash', $hash)->value('userId');
            $user = $owner ? DB::table('User')->where('id', $owner)->lockForUpdate()->first() : null;
            $challenge = DB::table('LoginChallenge')->where('tokenHash', $hash)->lockForUpdate()->first();
            if (! $challenge || ! $user || $user->status !== 'ACTIVE' || now()->greaterThanOrEqualTo($challenge->expiresAt) || $challenge->attempts >= 5 || ! hash_equals($challenge->passwordFingerprint, hash('sha256', $user->passwordHash))) {
                return null;
            }
            $security = DB::table('AccountSecurity')->where('userId', $user->id)->lockForUpdate()->first();
            DB::table('LoginChallenge')->where('tokenHash', $hash)->increment('attempts');
            if (! $security || ! TwoFactor::verify($security, trim($data['code']))) {
                return null;
            }
            DB::table('LoginChallenge')->where('tokenHash', $hash)->delete();
            DB::table('User')->where('id', $user->id)->update(['lastLoginAt' => Qfs::now()]);

            return [$user, SessionAuth::issue($user->id, $request)];
        });
        if (! $result) {
            return Api::error('INVALID_CODE', 'The code is incorrect or this sign-in expired. Try a new code or sign in again.', 400);
        }
        [$user, $token] = $result;

        return $this->cookie(Api::ok(['user' => $this->authResponse($user)]), $token, $user->locale ?? null);
    }

    public function me(Request $request): JsonResponse
    {
        if ($demo = SessionAuth::devUser($request)) {
            return Api::ok($demo);
        }
        $user = SessionAuth::user($request);

        return $user ? Api::ok(SessionAuth::publicUser($user))
            : Api::error('UNAUTHORIZED', 'Please log in to continue.', 401);
    }

    public function language(Request $request): JsonResponse
    {
        $data = $request->validate(['locale' => ['required', 'string', Rule::in(SetLanguage::available())]]);
        if (SessionAuth::devUser($request)) {
            return Api::ok(['locale' => $data['locale']]);
        }
        $user = Guard::user($request);
        DB::table('User')->where('id', $user->id)->update(['locale' => $data['locale'], 'updatedAt' => Qfs::now()]);

        return Api::ok(['locale' => $data['locale']]);
    }

    public function logout(Request $request): JsonResponse
    {
        SessionAuth::revoke($request);

        return Api::ok(['loggedOut' => true])->cookie('qfs_session', '', -1, '/', null,
            app()->environment('production'), true, false, 'lax');
    }

    private function authResponse(object $user): array
    {
        return array_intersect_key(SessionAuth::publicUser($user), array_flip([
            'id', 'name', 'email', 'role', 'status', 'referralCode',
        ]));
    }
}
