<!doctype html>
<html lang="{{ $htmlLang }}" dir="{{ $htmlDir }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title', 'QFS')</title>
    @hasSection('robots')<meta name="robots" content="@yield('robots')">@endif
    <link rel="icon" href="/favicon.ico">
    @include('partials.head-fonts')
    <link rel="stylesheet" href="/css/app.css">
    <style>[x-cloak]{display:none!important}</style>
    {{-- auth.js first so its alpine:init listener is ready before Alpine boots. --}}
    <script defer src="/js/language.js"></script>
    <script defer src="/js/auth.js"></script>
    <script defer src="/js/alpine.min.js"></script>
</head>
<body>
    <main class="auth-page">
        <div class="auth-glow auth-glow-one" aria-hidden="true"></div>
        <div class="auth-glow auth-glow-two" aria-hidden="true"></div>
        <div class="auth-pattern" aria-hidden="true"></div>
        <div class="auth-shell">
            <div class="auth-frame">
                {{-- Left: brand panel (desktop) --}}
                <aside class="auth-panel">
                    <img src="/logo/logo_Asset-5-1024x318-1.png" alt="QFS" class="auth-logo" width="172" height="54">
                    <div class="auth-panel-body">
                        <span class="label label-accent">Quantum Financial System</span>
                        <h2>Your Financial Freedom Begins Here</h2>
                        <p>{{ $tx('Unlock your financial freedom with QFS. Discover innovative solutions for secure and efficient financial management.') }}</p>
                    </div>
                    <div class="auth-panel-proof">
                        <div class="auth-proof-users">
                            <div class="auth-avatars">
                                <img class="avatar" src="/avatars/avatar4.jpg" alt="" width="40" height="40">
                                <img class="avatar" src="/avatars/avatar1.jpg" alt="" width="40" height="40">
                                <img class="avatar" src="/avatars/avatar2.jpg" alt="" width="40" height="40">
                                <img class="avatar" src="/avatars/avatar3.jpg" alt="" width="40" height="40">
                            </div>
                            <div class="auth-proof-text">
                                <strong>12.5M+</strong>
                                <span>World Enrolled Users</span>
                            </div>
                        </div>
                        <div class="auth-proof-award">
                            <img src="/award/award_Asset-6-2.png" alt="" width="40" height="36">
                            <p>2025's Best QFS Platform</p>
                        </div>
                    </div>
                    <img src="/cards/cc1-1-1024x869-1.png" alt="" class="auth-panel-card" width="420" height="356">
                </aside>

                {{-- Right: form card --}}
                <section class="auth-card">
                    <div class="auth-language">@include('partials.language-selector')</div>
                    <div class="auth-mobile-brand">
                        <img src="/logo/logo_Asset-5-1024x318-1.png" alt="QFS" class="auth-logo" width="150" height="47">
                    </div>

                    <div class="auth-head">
                        <span class="label label-accent">@yield('eyebrow')</span>
                        <h1>@yield('heading')</h1>
                        <p>@yield('subtitle')</p>
                    </div>

                    @yield('body')

                    <div class="auth-footer">@yield('footer')</div>
                </section>
            </div>
        </div>
    </main>
</body>
</html>
