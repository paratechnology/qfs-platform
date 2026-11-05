@extends('layouts.dashboard')

@php
    $titles = [
        'investments' => [$tx('Active Investments'), $tx('Active plans, accrued profit, payouts, and completed terms.')],
        'transactions' => [$tx('Transactions'), $tx('Completed movements and account activity.')],
        'withdrawals' => [$tx('Withdrawals'), $tx('Track requests from submission to review.')],
        'loans' => [$tx('Loans'), $tx('Your applications and their current status.')],
        'verification' => [$tx('Identity verification'), $tx('Submit your identity documents for private review.')],
        'settings' => [$tx('Account settings'), $tx('Profile, password, two-factor authentication and active sessions.')],
        'statements' => [$tx('Account statements'), $tx('Download your account activity and investment records.')],
    ];
    $kyc = $overview['kyc'] ?? null;
    $u = $overview['user'] ?? [];
@endphp

@section('title', ($view === 'dashboard' ? $tx('Dashboard') : ($titles[$view][0] ?? $tx('Account'))) . ' | QFS')

@section('dash-content')
    {{-- KYC banner --}}
    @if ($view !== 'verification' && ($kyc['status'] ?? null) !== 'APPROVED' && ($u['kycLevel'] ?? 0) === 0)
        <div class="dash-kyc-banner">
            <div>
                <strong>{{ ($kyc['status'] ?? null) === 'PENDING' ? 'Identity review in progress' : (($kyc['status'] ?? null) === 'NEEDS_CHANGES' ? 'Your verification needs an update' : 'Complete your identity verification') }}</strong>
                <span>{{ ($kyc['status'] ?? null) === 'PENDING' ? 'Your documents are awaiting admin review.' : 'Review your details and upload your identity documents privately.' }}</span>
            </div>
            <a href="/user/user/dashboard/verification">{{ $tx('Verify identity') }} <x-dash-icon name="right-arrow" :size="14" /></a>
        </div>
    @endif

    @if ($view !== 'dashboard')
        {{-- ---------- Sub-view workspace ---------- --}}
        <section class="dash-workspace">
            <a class="dash-page-back" href="/user/user/dashboard"><x-dash-icon name="right-arrow" class="dash-return-arrow" :size="16" /> {{ $tx('Back to dashboard') }}</a>
            <header class="dash-page-header">
                <div>
                    <span class="dash-page-eyebrow">{{ $tx('Your account') }}</span>
                    <h1>{{ $titles[$view][0] ?? $tx('Account') }}</h1>
                    <p>{{ $titles[$view][1] ?? '' }}</p>
                </div>
                @if ($view === 'loans')
                    <button type="button" class="dash-btn primary" @click="openModal('loanApply')"><x-dash-icon name="plus-circle" :size="16" /> {{ $tx('Apply for Loan') }}</button>
                @elseif ($view === 'investments')
                    <button type="button" class="dash-btn primary" @click="openModal('invest')"><x-dash-icon name="plus-circle" :size="16" /> {{ $tx('Start New Investment') }}</button>
                @endif
            </header>
            @include('dashboard.views.' . $view)
        </section>
    @else
        {{-- ---------- Overview ---------- --}}
        <div class="dash-welcome">
            <div>
                <h1>Welcome Back, {{ $u['name'] ?? '' ? explode(' ', $u['name'])[0] : '' }} 👋</h1>
                <p>Here is what's happening with your QFS account today. · {{ $u['memberSince'] ?? '' }}</p>
            </div>
            <span class="dash-welcome-date">{{ now()->format('l, F j, Y') }}</span>
        </div>

        @include('dashboard.partials.funds-panel')
        @include('dashboard.partials.review-reel')

        {{-- Balance cards --}}
        @php
            $quickIco = fn ($key) => $key === 'loans' ? 'wallet' : ($key === 'withdrawals' ? 'arrow-redo' : ($key === 'earnings' ? 'trending-up' : 'card'));
            $balanceCards = collect($overview['balanceCards'] ?? [])->filter(fn ($c) => ! in_array($c['key'] ?? '', ['balance', 'loans', 'investments'], true));
        @endphp
        <div class="dash-balance-grid">
            @foreach ($balanceCards as $b)
                @include('dashboard.partials.balance-card', ['b' => $b, 'ico' => $quickIco($b['key'])])
            @endforeach
        </div>
        <div class="dash-balance-scroller">
            @foreach ($balanceCards as $b)
                @include('dashboard.partials.balance-card', ['b' => $b, 'ico' => $quickIco($b['key'])])
            @endforeach
        </div>

        {{-- Markets --}}
        <div class="dash-section-title" id="dashboard-markets">
            <h2>{{ $tx('Markets') }}</h2>
            <span class="dash-section-link" style="cursor:default;color:var(--dash-muted)">{{ $tx('Live preview') }}</span>
        </div>
        <div class="dash-card dash-card-pad" x-data="{ tab: 'metals' }">
            <div class="dash-tabs" style="margin-bottom:14px">
                <button class="dash-tab" :class="{ active: tab === 'metals' }" @click="tab = 'metals'">{{ $tx('Markets') }}</button>
                <button class="dash-tab" :class="{ active: tab === 'stocks' }" @click="tab = 'stocks'">{{ $tx('Stocks') }}</button>
                <button class="dash-tab" :class="{ active: tab === 'crypto' }" @click="tab = 'crypto'">Metals &amp; Crypto</button>
            </div>
            @foreach (['metals', 'stocks', 'crypto'] as $segment)
                <div class="dash-market-table-wrap" style="overflow-x:auto" x-show="tab === '{{ $segment }}'" @if($segment !== 'metals') x-cloak @endif>
                    <table class="dash-market-table">
                        <thead><tr><th>{{ $tx('Asset') }}</th><th>{{ $tx('Price') }}</th><th>{{ $tx('Change (24h)') }}</th></tr></thead>
                        <tbody>
                            @foreach ($overview['markets'][$segment] ?? [] as $m)
                                <tr>
                                    <td>
                                        <div class="dash-mkt-symbol">
                                            <span class="dash-mkt-logo" style="background:{{ $m['color'] ?? '#2b2b3a' }};color:#fff">{{ substr($m['sym'], 0, 1) }}</span>
                                            <span class="dash-mkt-name"><b>{{ $m['name'] }}</b><span>{{ $m['full'] }}</span></span>
                                        </div>
                                    </td>
                                    @if ($segment === 'crypto' && ($m['live'] ?? true) === false)
                                        <td class="dash-price">{{ $tx('Quote unavailable') }}</td>
                                        <td><span class="dash-change">—</span></td>
                                    @else
                                        <td class="dash-price">${{ $m['price'] }}</td>
                                        <td><span class="dash-change {{ ($m['up'] ?? false) ? 'up' : 'down' }}">{{ $m['chg'] }}</span></td>
                                    @endif
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>
            @endforeach
        </div>

        {{-- Referral --}}
        <div class="dash-section-title">
            <h2>{{ $tx('Referral Program') }}</h2>
            <span class="dash-section-link">{{ $overview['referral']['count'] ?? 0 }} referred · {{ $overview['referral']['earnings'] ?? '$0.00' }} earned</span>
        </div>
        <div class="dash-card dash-card-pad" x-data="referralLink(@js(['url' => $overview['referral']['url'] ?? '', 'code' => $overview['user']['referralCode'] ?? '']))">
            <div class="dash-referral-input">
                <input readonly :value="link" aria-label="{{ $tx('Your referral link') }}">
                <button class="dash-referral-copy" :class="{ copied }" @click="navigator.clipboard?.writeText(link); copied = true; setTimeout(() => copied = false, 1500)">
                    <span x-show="!copied"><x-dash-icon name="copy" :size="14" /></span>
                    <span x-show="copied" x-cloak><x-dash-icon name="check" :size="14" /></span>
                    <span x-text="copied ? 'Copied' : 'Copy'"></span>
                </button>
            </div>
            <div class="dash-referral-row">
                <button class="dash-btn info" style="flex:1" @click="navigator.share ? navigator.share({ url: link }) : (navigator.clipboard?.writeText(link), copied = true, setTimeout(() => copied = false, 1500))"><x-dash-icon name="share" :size="14" /> {{ $tx('Share Link') }}</button>
                <p class="dash-input-note" style="flex:1.4;align-self:center;margin:0">Earn {{ (($overview['referral']['rateBps'] ?? 500) / 100) }}% in USD when someone you invite has a deposit approved.</p>
            </div>
        </div>

        {{-- Resources: documents / reviews --}}
        <div class="dash-section-title"><h2>{{ $tx('Resources') }}</h2></div>
        <div class="dash-card" x-data="{ tab: 'documents' }">
            <div style="padding:16px 16px 0">
                <div class="dash-tabs">
                    <button class="dash-tab" :class="{ active: tab === 'documents' }" @click="tab = 'documents'">{{ $tx('Documents') }}</button>
                    <button class="dash-tab" :class="{ active: tab === 'reviews' }" @click="tab = 'reviews'">{{ $tx('Reviews') }}</button>
                </div>
            </div>
            <div class="dash-card-pad">
                <div x-show="tab === 'documents'">
                    <ul class="dash-docs-list">
                        @forelse ($overview['documents'] ?? [] as $d)
                            <li><a class="dash-doc-link" href="{{ $d['fileUrl'] }}" target="_blank" rel="noreferrer">
                                <img class="dash-flag" src="{{ $d['flag'] }}" alt="{{ $d['label'] }}">
                                <span class="dash-doc-name"><x-dash-icon name="file-pdf" :size="15" /><span>{{ $d['label'] }}</span></span>
                                <x-dash-icon name="chevron-right" class="dash-chevron" :size="14" /></a>
                            </li>
                        @empty
                            <li class="dash-empty" style="cursor:default">No documents yet.</li>
                        @endforelse
                    </ul>
                </div>
                <div x-show="tab === 'reviews'" x-cloak>
                    @include('dashboard.partials.reviews-tab')
                </div>
            </div>
        </div>

        {{-- Recent transactions --}}
        <div class="dash-section-title">
            <h2>{{ $tx('Recent Transactions') }}</h2>
            <a class="dash-section-link" href="/user/user/dashboard/transactions" style="background:none;border:0;cursor:pointer">{{ $tx('View All') }}</a>
        </div>
        <div class="dash-card dash-card-pad">
            <div class="dash-tx-list">
                @forelse (array_slice($overview['recentTx'] ?? [], 0, 5) as $t)
                    @include('dashboard.partials.tx-row', ['t' => $t])
                @empty
                    <p class="dash-empty">No transactions yet.</p>
                @endforelse
            </div>
        </div>

        <p style="text-align:center;color:var(--dash-muted-2);font-size:12px;margin-top:40px">© 2026 q-arculuspro.live — QFS Account Dashboard</p>
    @endif
@endsection
