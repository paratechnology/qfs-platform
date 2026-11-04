@extends('layouts.auth')

@section('title', 'Log In | QFS')
@section('eyebrow', 'Welcome Back')
@section('heading', 'Log In to Your Account')
@section('subtitle', 'Access your QFS dashboard, wallets and trading history.')

@section('body')
@if (request('reason') === 'session-expired')
    <p class="auth-recovery-note" role="status">{{ $tx('Your session expired after a period of inactivity. Please sign in again.') }}</p>
@endif
<form class="auth-form" method="post"
      x-data="signInForm({ endpoint: '/api/auth/login', mode: 'login', redirect: '/user/user/dashboard' })"
      @submit.prevent="submit($event)" :aria-busy="busy">
    <fieldset :disabled="busy" style="border:0;padding:0;margin:0;min-width:0">
        {{-- Credentials --}}
        <template x-if="!challenge">
            <div>
                <x-auth.field label="Email Address" type="email" id="login-email" name="email"
                    placeholder="you@example.com" autocomplete="email" icon="mail" />
                <x-auth.password label="Password" id="login-password" name="password"
                    placeholder="Enter your password" autocomplete="current-password" />
                <div class="auth-form-row"><a class="auth-link" href="/forgot-password">Forgot password?</a></div>
            </div>
        </template>

        {{-- Two-factor challenge --}}
        <template x-if="challenge">
            <div>
                <p>{{ $tx('Enter the code from your authenticator app, or use an unused recovery code.') }}</p>
                <label class="auth-field" for="login-factor">Authenticator or recovery code</label>
                <div class="auth-input">
                    <input id="login-factor" name="code" dir="ltr" autocomplete="one-time-code" maxlength="30" required>
                </div>
            </div>
        </template>

        <p class="auth-form-error" role="alert" x-show="error" x-text="error" x-cloak></p>

        <button type="submit" class="auth-submit" :disabled="busy">
            <span x-show="!busy" style="display:inline-flex;align-items:center;gap:10px">
                <span x-text="challenge ? 'Verify and sign in' : 'Log In'"></span>
                <x-icon name="arrow-right" :size="16" />
            </span>
            <span x-show="busy" x-cloak style="display:inline-flex;align-items:center;gap:10px">
                <span class="auth-submit-spinner" aria-hidden="true"></span>
                <span x-text="signedIn ? 'Signed in. Opening your dashboard…' : (challenge ? 'Verifying…' : 'Signing in…')"></span>
            </span>
        </button>

        <button type="button" class="auth-link" x-show="challenge" x-cloak @click="challenge=''; error=''">Back to sign in</button>
    </fieldset>
</form>
@endsection

@section('footer')
<p>Don't have an account? <a class="auth-link" href="/user/user/register">Create one</a></p>
@endsection
