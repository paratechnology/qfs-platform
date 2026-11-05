<!doctype html>
<html lang="{{ $htmlLang }}" dir="{{ $htmlDir }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title', 'QFS — Quantum Financial System')</title>
    <meta name="description" content="@yield('description', 'Quantum Financial System — decentralized, asset-backed finance.')">
    <link rel="icon" href="/favicon.ico">
    @include('partials.head-fonts')
    <link rel="stylesheet" href="/css/app.css">
    {{-- Reveal animations need JS; show content if JS is unavailable. --}}
    <script>document.documentElement.classList.add('js')</script>
    <style>
        html:not(.js) .reveal { opacity: 1 !important; }
        [x-cloak] { display: none !important; }
    </style>
    <script defer src="/js/language.js"></script>
    <script defer src="/js/alpine.min.js"></script>
    <script defer src="/js/site.js"></script>
</head>
<body>
    <header class="header" x-data="{ open: false }">
        <div class="container-lg">
            <div class="header-inner">
                <a href="/" class="header-logo">
                    <img src="/logo/logo_Asset-5-1024x318-1.png" alt="QFS" width="160" height="50">
                </a>

                <div class="header-main">
                    <nav class="header-nav">
                        <a href="/" class="active">{{ $tx('Home') }}</a>
                        <a href="/#about">{{ $tx('About') }}</a>
                        <a href="/#services">{{ $tx('Services') }}</a>
                        <a href="/#contact">{{ $tx('Contact') }}</a>
                        <a href="/user/user/connect">{{ $tx('Connect Wallet') }}</a>
                        <a href="/user/user/login">{{ $tx('Login') }}</a>
                        <a href="/user/user/register">{{ $tx('Register') }}</a>
                    </nav>

                    <div class="header-cta">
                        @include('partials.language-selector')
                        <a class="header-login" href="/user/user/login">{{ $tx('Log In') }} <x-icon name="arrow-right" :size="14" /></a>
                    </div>

                    <button type="button" class="header-hamburger"
                        :aria-label="open ? 'Close menu' : 'Open menu'" :aria-expanded="open"
                        aria-controls="site-mobile-nav" @click="open = !open">
                        <span></span><span></span><span></span>
                    </button>
                </div>
            </div>

            <div class="mobile-panel" id="site-mobile-nav" x-show="open" x-cloak>
                <img src="/logo/logo_Asset-7-1.png" alt="QFS" width="180" height="56">
                <nav>
                    <a href="/" class="active" @click="open = false">{{ $tx('Home') }}</a>
                    <a href="/#about" @click="open = false">{{ $tx('About') }}</a>
                    <a href="/#services" @click="open = false">{{ $tx('Services') }}</a>
                    <a href="/#contact" @click="open = false">{{ $tx('Contact') }}</a>
                    <a href="/user/user/connect" @click="open = false">{{ $tx('Connect Wallet') }}</a>
                    <a href="/user/user/login" @click="open = false">{{ $tx('Login') }}</a>
                    <a href="/user/user/register" @click="open = false">{{ $tx('Register') }}</a>
                </nav>
                @include('partials.language-selector')
            </div>
        </div>
    </header>

    @yield('content')

    <footer class="footer">
        <div class="footer-pattern" aria-hidden="true"></div>
        <div class="container-lg">
            <div class="footer-grid">
                <div class="footer-intro">
                    <img src="/logo/logo_Asset-5-1024x318-1.png" alt="QFS" width="240" height="74">
                    <p>{{ $tx('JOIN THE BIGGEST FINANCIAL REVOLUTIONARY SYSTEM DESIGNED TO OVERTAKE THE WORLD\'S BANKING SYSTEM BY ELIMINATING CONTROL OF MONEY BY CABALS.') }}</p>
                </div>
                <div class="footer-cols">
                    <div class="footer-col">
                        <h4>{{ $tx('Quicklinks') }}</h4>
                        <ul>
                            <li><a href="/">{{ $tx('Home') }}</a></li>
                            <li><a href="/#about">{{ $tx('About') }}</a></li>
                            <li><a href="/#services">{{ $tx('Services') }}</a></li>
                            <li><a href="/#contact">{{ $tx('Contact') }}</a></li>
                            <li><a href="/user/user/login">{{ $tx('Login') }}</a></li>
                        </ul>
                    </div>
                    <div class="footer-col">
                        <h4>{{ $tx('Email') }}</h4>
                        <ul class="email-list">
                            <li><a href="mailto:support@q-arculuspro.live">support@q-arculuspro.live</a></li>
                        </ul>
                        <h4 style="margin-top:30px">{{ $tx('Support') }}</h4>
                        <ul>
                            <li><a href="mailto:support@q-arculuspro.live">{{ $tx('Help Center') }}</a></li>
                            <li><a href="/#contact">{{ $tx('Contact') }}</a></li>
                        </ul>
                    </div>
                    <div class="footer-col">
                        <h4>{{ $tx('Let\'s Talk!') }}</h4>
                        <p>{{ $tx('Questions about your account? Send us an email.') }}</p>
                        <a class="footer-livechat" href="mailto:support@q-arculuspro.live"><x-icon name="bubble" :size="14" /> {{ $tx('Email Support') }}</a>
                    </div>
                </div>
            </div>
        </div>
    </footer>

    <div class="copyright">
        <div class="container-lg">
            <div class="copyright-inner">
                <p>Copyright © 2026 q-arculuspro.live</p>
            </div>
        </div>
    </div>
</body>
</html>
