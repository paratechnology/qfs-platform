@extends('layouts.auth')

@section('title', $reset ? 'Reset password | QFS' : 'Account recovery | QFS')
@if ($reset)
    @section('robots', 'noindex, nofollow')
@endif
@section('eyebrow', 'Account recovery')
@section('heading', $reset ? 'Set a New Password' : 'Forgot Your Password?')
@section('subtitle', $reset ? 'Choose a new password for your QFS account.' : 'Enter your account email to request a private recovery link.')

@section('body')
<div x-data="recoveryForm({ reset: {{ $reset ? 'true' : 'false' }} })">
    {{-- Brief loading state while we read the recovery token from the URL. --}}
    <p class="auth-recovery-note" role="status" x-show="!ready" x-cloak>
        {{ $reset ? 'Opening recovery link…' : 'Opening account recovery…' }}
    </p>

    {{-- Success --}}
    <div class="auth-recovery-result" role="status" x-show="ready && success" x-cloak>
        <h2>{{ $reset ? 'Password changed' : 'Check your email' }}</h2>
        @if ($reset)
            <p>Your existing sessions have been signed out. Sign in with your new password.</p>
            <a class="auth-link" href="/user/user/login">Sign in <x-icon name="arrow-right" :size="16" /></a>
        @else
            <p>If an active account matches this email, look for a password reset link. Check your spam folder too. The link expires in 30 minutes.</p>
            <p>If the email does not arrive, try again or contact support.</p>
            <button type="button" class="auth-link auth-recovery-again" @click="success = false">Send another link</button>
        @endif
    </div>

    @if ($reset)
        {{-- Reset opened without a valid token in the URL hash. --}}
        <div class="auth-recovery-result" role="alert" x-show="ready && !success && !token" x-cloak>
            <h2>Recovery link missing</h2>
            <p>Open the complete link from your recovery email, or request a new one.</p>
            <a class="auth-link" href="/forgot-password">Request a new link <x-icon name="arrow-right" :size="16" /></a>
        </div>
    @endif

    {{-- Form --}}
    <form class="auth-form" method="post" @submit.prevent="submit($event)"
          x-show="ready && !success @if ($reset) && token @endif" x-cloak>
        <fieldset class="auth-recovery-fields" :disabled="busy">
            @if ($reset)
                <x-auth.password label="New password" id="recovery-password" name="password" autocomplete="new-password" />
                <x-auth.password label="Confirm new password" id="recovery-confirm" name="confirmPassword" autocomplete="new-password" />
                <p class="auth-recovery-note">{{ $tx('Use 10–72 characters, including a letter and a number. After reset, you’ll need to sign in again.') }}</p>
            @else
                <x-auth.field label="Email address" type="email" id="recovery-email" name="email"
                    placeholder="you@example.com" autocomplete="email" icon="mail" />
            @endif

            <p class="auth-form-error" role="alert" x-show="error" x-text="error" x-cloak></p>

            <button class="auth-submit" type="submit" :disabled="busy">
                <span x-show="!busy" style="display:inline-flex;align-items:center;gap:10px">
                    <span>{{ $reset ? 'Set new password' : 'Send recovery link' }}</span>
                    <x-icon name="arrow-right" :size="16" />
                </span>
                <span x-show="busy" x-cloak style="display:inline-flex;align-items:center;gap:10px">
                    <span class="auth-submit-spinner" aria-hidden="true"></span>
                    <span>{{ $reset ? 'Changing password…' : 'Requesting link…' }}</span>
                </span>
            </button>
        </fieldset>
        @if ($reset)
            <a class="auth-link" href="/forgot-password">Link expired? Request a new one</a>
        @endif
    </form>
</div>
@endsection

@section('footer')
<p>
    <a class="auth-link" href="/user/user/login">Back to sign in</a> ·
    <a class="auth-link" href="mailto:support@q-arculuspro.live?subject=Account%20recovery">Contact support</a>
</p>
@endsection
