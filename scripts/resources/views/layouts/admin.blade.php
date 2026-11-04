@php
    $nav = [
        ['overview', '/admin', 'Overview', 'dashboard'],
        ['users', '/admin/users', 'Users', 'wallet'],
        ['kyc', '/admin/kyc', 'Identity Verification', 'file-pdf'],
        ['requests', '/admin/requests', 'Deposit / Withdrawal Requests', 'arrow-down'],
        ['transactions', '/admin/transactions', 'Transactions', 'swap-vert'],
        ['swaps', '/admin/swaps', 'Crypto swaps', 'swap-vert'],
        ['plans', '/admin/plans', 'Investment Plans', 'trending-up'],
        ['investments', '/admin/investments', 'Principal Releases', 'trending-up'],
        ['loans', '/admin/loans', 'Loans', 'wallet'],
        ['documents', '/admin/documents', 'Documents', 'file-pdf'],
        ['reviews', '/admin/reviews', 'Reviews', 'star'],
        ['wallet-issues', '/admin/wallet-issues', 'Wallet Issues', 'wallet'],
        ['markets', '/admin/markets', 'Markets', 'search'],
        ['settings', '/admin/settings', 'Settings', 'timer'],
        ['security', '/admin/security', 'Account security', 'wallet'],
        ['reconciliation', '/admin/reconciliation', 'Reconciliation', 'list'],
        ['audit', '/admin/audit', 'Audit Log', 'list'],
    ];
    $crumbShort = ['kyc' => 'KYC', 'requests' => 'Requests', 'plans' => 'Plans'];
    $current = collect($nav)->firstWhere(0, $page) ?? $nav[0];
@endphp
<!doctype html>
<html lang="{{ $htmlLang }}" dir="{{ $htmlDir }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title', 'Admin | QFS')</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="icon" href="/favicon.ico">
    @include('partials.head-fonts')
    <link rel="stylesheet" href="/css/app.css">
    <link rel="stylesheet" href="/css/dashboard.css">
    <link rel="stylesheet" href="/css/admin.css">
    <style>[x-cloak]{display:none!important}</style>
    @include('partials.session-idle', ['sessionLoginPath' => '/admin/login'])
    <script defer src="/js/language.js"></script>
    <script defer src="/js/admin.js"></script>
    <script defer src="/js/dash-forms.js"></script>
    <script defer src="/js/kyc-history.js"></script>
    <script defer src="/js/alpine.min.js"></script>
</head>
<body>
<div class="qfs-dash qfs-admin" :class="{ 'sidebar-open': sidebarOpen }" :data-theme="theme" x-data="admShell()" x-cloak>
    <aside class="adm-sidebar">
        <div class="adm-sb-head">
            <img src="/logo/logo_Asset-5-1024x318-1.png" alt="QFS">
            <span class="adm-sb-role">Admin</span>
            <button class="adm-sb-close" aria-label="Close menu" @click="sidebarOpen = false"><x-dash-icon name="close" /></button>
        </div>

        <div class="adm-sb-profile">
            <img src="{{ $adminUser['avatarUrl'] ?: '/avatars/avatar1.jpg' }}" alt="{{ $adminUser['name'] }}">
            <div class="adm-sb-profile-in">
                <strong>{{ $adminUser['name'] }}</strong>
                <span>{{ $adminUser['email'] }}</span>
            </div>
        </div>

        <nav class="adm-sb-nav">
            @foreach ($nav as [$key, $href, $label, $ico])
                <a href="{{ $href }}" class="adm-sb-link {{ $page === $key ? 'active' : '' }}">
                    <span class="adm-sb-link-ico"><x-dash-icon :name="$ico" :size="16" /></span>
                    <span>{{ $label }}</span>
                </a>
            @endforeach
        </nav>

        <div class="adm-sb-foot">
            <a class="adm-sb-link" href="/"><span class="adm-sb-link-ico"><x-dash-icon name="card" :size="16" /></span><span>View Public Site</span></a>
            <a class="adm-sb-link" href="/user/user/dashboard"><span class="adm-sb-link-ico"><x-dash-icon name="dashboard" :size="16" /></span><span>User Dashboard</span></a>
            <button class="adm-sb-link adm-sb-link-danger" @click="logout" :disabled="busy"><span class="adm-sb-link-ico"><x-dash-icon name="log-out" :size="16" /></span><span x-text="busy ? 'Signing out…' : 'Logout'"></span></button>
        </div>
    </aside>

    <div class="adm-overlay" @click="sidebarOpen = false"></div>

    <div class="adm-main">
        <header class="adm-topbar">
            <button class="adm-hamburger" aria-label="Open menu" @click="sidebarOpen = true"><x-dash-icon name="menu" /></button>
            <div class="adm-topbar-title">
                <span class="adm-topbar-kicker">{{ $tx('QFS Control Center') }}</span>
                <b>Admin Dashboard</b>
            </div>
            <div class="adm-topbar-spacer"></div>
            <div class="adm-topbar-actions">
                @include('partials.language-selector')
                <button class="adm-icon-btn" aria-label="Toggle theme" @click="toggleTheme">
                    <span x-show="theme === 'light'"><x-dash-icon name="moon" :size="17" /></span>
                    <span x-show="theme !== 'light'" x-cloak><x-dash-icon name="sun" :size="17" /></span>
                </button>
                <div class="adm-chip-wrap">
                    <button class="adm-user-chip" @click="menuOpen = !menuOpen">
                        <img src="{{ $adminUser['avatarUrl'] ?: '/avatars/avatar1.jpg' }}" alt="{{ $adminUser['name'] }}">
                        <span>{{ explode(' ', $adminUser['name'])[0] }}</span>
                        <x-dash-icon name="chevron-down" :size="13" />
                    </button>
                    <div class="adm-user-menu" x-show="menuOpen" x-cloak @click.outside="menuOpen = false">
                        <button @click="logout" :disabled="busy"><x-dash-icon name="log-out" :size="14" /> <span x-text="busy ? 'Signing out…' : 'Logout'"></span></button>
                    </div>
                </div>
            </div>
        </header>

        <main class="adm-body">
            <nav class="adm-crumbs" aria-label="Breadcrumb">
                <ol>
                    <li><a href="/admin">Admin</a></li>
                    <li class="adm-crumbs-sep" aria-hidden="true">/</li>
                    <li><span aria-current="page">{{ $crumbShort[$page] ?? $current[2] }}</span></li>
                </ol>
            </nav>
            @yield('admin-content')
        </main>

        <p class="adm-footer">© 2026 q-arculuspro.live — QFS Admin Console</p>
    </div>
</div>
</body>
</html>
