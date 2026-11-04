@extends('layouts.auth')

@php
$countries = [
    'United States', 'United Kingdom', 'Canada', 'Australia', 'Ghana', 'Nigeria',
    'South Africa', 'Kenya', 'Egypt', 'Germany', 'France', 'Netherlands', 'Spain',
    'Italy', 'Switzerland', 'India', 'Pakistan', 'Bangladesh', 'United Arab Emirates',
    'Saudi Arabia', 'Brazil', 'Mexico', 'China', 'Japan', 'Singapore', 'Philippines',
    'Indonesia', 'Other',
];
@endphp

@section('title', 'Register | QFS')
@section('eyebrow', 'Create Account')
@section('heading', 'Register for QFS')
@section('subtitle', 'Set up your QFS account to access wallets, trading and payments.')

@section('body')
<div x-data="signInForm({ endpoint: '/api/auth/register', mode: 'register', redirect: '/user/user/dashboard' })">
    {{-- Success state --}}
    <template x-if="registered">
        <div class="auth-recovery-result" role="status">
            <h2>Account registration successful.</h2>
            <p>{{ $tx('Sign in with your email address and password to access your account.') }}</p>
            <a class="auth-link" href="/user/user/login">Click here to log in <x-icon name="arrow-right" :size="16" /></a>
        </div>
    </template>

    {{-- Registration form --}}
    <template x-if="!registered">
        <form class="auth-form" method="post" @submit.prevent="submit($event)" :aria-busy="busy">
            <fieldset :disabled="busy" style="border:0;padding:0;margin:0;min-width:0">
                <div class="auth-row">
                    <x-auth.field label="First Name" id="register-first" name="firstName"
                        placeholder="Your first name" autocomplete="given-name" icon="user" />
                    <x-auth.field label="Last Name" id="register-last" name="lastName"
                        placeholder="Your last name" autocomplete="family-name" icon="user" />
                </div>
                <x-auth.field label="Email Address" type="email" id="register-email" name="email"
                    placeholder="you@example.com" autocomplete="email" icon="mail" />
                <x-auth.field label="Country" id="register-country" name="country"
                    placeholder="Select your country" icon="globe" :select="true" :options="$countries" />
                <x-auth.field label="Phone Number" type="tel" id="register-phone" name="phone"
                    placeholder="+1 (555) 000-0000" autocomplete="tel" icon="phone" />
                <x-auth.password label="Password" id="register-password" name="password"
                    placeholder="Create a password" autocomplete="new-password" />
                <x-auth.password label="Confirm Password" id="register-confirm" name="confirmPassword"
                    placeholder="Re-type your password" autocomplete="new-password" />

                <p class="auth-form-error" role="alert" x-show="error" x-text="error" x-cloak></p>

                <button type="submit" class="auth-submit" :disabled="busy">
                    <span x-show="!busy" style="display:inline-flex;align-items:center;gap:10px">
                        <span>Create Account</span>
                        <x-icon name="arrow-right" :size="16" />
                    </span>
                    <span x-show="busy" x-cloak style="display:inline-flex;align-items:center;gap:10px">
                        <span class="auth-submit-spinner" aria-hidden="true"></span>
                        <span>Creating account…</span>
                    </span>
                </button>
            </fieldset>
        </form>
    </template>
</div>
@endsection

@section('footer')
<p>Already have an account? <a class="auth-link" href="/user/user/login">Log in</a></p>
@endsection
