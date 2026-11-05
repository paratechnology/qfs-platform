@php
    $u = $overview['user'] ?? [];
    $firstName = $u['name'] ?? '' ? explode(' ', $u['name'])[0] : '';
    $activeCount = $overview['investmentSummary']['activeCount'] ?? 0;
    $unread = $overview['notifications']['unread'] ?? 0;
    $nav = [
        ['dashboard', $tx('Dashboard'), 'dashboard', null, '/user/user/dashboard'],
        ['investments', $tx('Active Investments'), 'trending-up', $activeCount ?: null, '/user/user/dashboard/investments'],
        ['transactions', $tx('Transactions'), 'swap-vert', null, '/user/user/dashboard/transactions'],
        ['statements', $tx('Account statements'), 'file-pdf', null, '/user/user/dashboard/statements'],
        ['withdrawals', $tx('Withdrawals'), 'arrow-up', null, '/user/user/dashboard/withdrawals'],
        ['loans', $tx('Loans'), 'list', null, '/user/user/dashboard/loans'],
    ];
    $manage = [
        ['verification', $tx('Identity Verification'), 'check', '/user/user/dashboard/verification'],
        ['settings', $tx('Account settings'), 'list', '/user/user/dashboard/settings'],
    ];
@endphp
<!doctype html>
<html lang="{{ $htmlLang }}" dir="{{ $htmlDir }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title', $tx('Dashboard') . ' | QFS')</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="icon" href="/favicon.ico">
    @include('partials.head-fonts')
    @include('partials.dashboard-ui-strings')
    <link rel="stylesheet" href="/css/app.css">
    <link rel="stylesheet" href="/css/dashboard.css">
    <style>[x-cloak]{display:none!important}</style>
    @include('partials.session-idle', ['sessionLoginPath' => '/user/user/login'])
    <script defer src="/js/language.js"></script>
    <script defer src="/js/dashboard.js"></script>
    <script defer src="/js/dash-views.js"></script>
    <script defer src="/js/dash-forms.js"></script>
    <script src="/js/dash-money.js"></script>
    <script defer src="/js/wallet.js"></script>
    <script defer src="/js/dash-reel.js"></script>
    <script defer src="/js/qrcode.bundle.js"></script>
    <script src="/js/dash-crypto.js"></script>
    <script defer src="/js/kyc-history.js"></script>
    <script defer src="/js/alpine.min.js"></script>
</head>
<body>
<div class="qfs-dash" :class="{ 'sidebar-open': sidebarOpen }" :data-theme="theme" x-data="dashboard(@js(['unread' => $unread, 'items' => $overview['notifications']['items'] ?? []]))" @dash-close-modal.window="closeModal()" @dash-open-modal.window="openModal($event.detail)" @dash-toast.window="showToast($event.detail)" x-cloak>
    {{-- ---------- Sidebar ---------- --}}
    <aside class="dash-sidebar">
        <div class="dash-sb-head">
            <img src="/logo/logo_Asset-5-1024x318-1.png" alt="QFS">
            <button class="dash-sb-close" aria-label="{{ $tx('Close menu') }}" @click="sidebarOpen = false"><x-dash-icon name="close" /></button>
        </div>

        <div class="dash-sb-profile">
            <img src="{{ $u['avatarUrl'] ?? '/avatars/avatar1.jpg' }}" alt="{{ $u['name'] ?? '' }}">
            <div class="dash-sb-profile-in">
                <strong>{{ $u['name'] ?? '' }}</strong>
                <span><x-dash-icon name="map-pin" :size="13" /> {{ $u['country'] ?? '' }}</span>
            </div>
        </div>

        <div class="dash-sb-balance">
            <div class="dash-sb-balance-label">{{ $tx('Available balance') }}</div>
            <div class="dash-sb-balance-amount" x-text="portfolioAvailable ?? '—'">—</div>
            <span class="dash-sb-balance-note">{{ $tx('USD value') }}</span>
        </div>

        <div class="dash-sb-actions">
            <a class="dash-sb-action" href="/user/user/dashboard/withdrawals" @click.prevent="openModal('deposit')"><x-dash-icon name="arrow-down" :size="13" /> {{ $tx('Add Fund') }}</a>
            <button class="dash-sb-action dash-sb-action-danger" @click="logout" :disabled="busy"><x-dash-icon name="log-out" :size="13" /> {{ $tx('Logout') }}</button>
        </div>

        <nav class="dash-sb-nav" aria-label="{{ $tx('Account navigation') }}">
            <div class="dash-sb-group-title">{{ $tx('Account') }}</div>
            @foreach ($nav as [$key, $label, $ico, $badge, $href])
                <a class="dash-sb-link {{ $view === $key ? 'active' : '' }}" href="{{ $href }}" @if($view === $key) aria-current="page" @endif>
                    <span class="dash-sb-link-ico"><x-dash-icon :name="$ico" /></span>{{ $label }}
                    @if ($badge)<span class="dash-sb-link-badge">{{ $badge }}</span>@endif
                </a>
            @endforeach
            <div class="dash-sb-group-title">{{ $tx('Manage') }}</div>
            @foreach ($manage as [$key, $label, $ico, $href])
                <a class="dash-sb-link {{ $view === $key ? 'active' : '' }}" href="{{ $href }}" @if($view === $key) aria-current="page" @endif>
                    <span class="dash-sb-link-ico"><x-dash-icon :name="$ico" /></span>{{ $label }}
                </a>
            @endforeach
            <button class="dash-sb-link" @click="openModal('cards')"><span class="dash-sb-link-ico"><x-dash-icon name="card" /></span>{{ $tx('My Cards') }}</button>
            <a class="dash-sb-link" href="/user/user/connect"><span class="dash-sb-link-ico"><x-dash-icon name="wallet" /></span>{{ $tx('Secure Wallet') }}</a>
        </nav>
    </aside>

    <div class="dash-overlay" @click="sidebarOpen = false"></div>

    {{-- ---------- Main ---------- --}}
    <div class="dash-main">
        <header class="dash-topbar">
            <button class="dash-hamburger" :aria-expanded="sidebarOpen" aria-label="{{ $tx('Open menu') }}" @click="sidebarOpen = true"><x-dash-icon name="menu" /></button>
            <img class="dash-topbar-logo" src="/logo/logo_Asset-5-1024x318-1.png" alt="QFS">

            <div class="dash-topbar-search" x-data="dashSearch()">
                <x-dash-icon name="search" :size="16" />
                <input placeholder="{{ $tx('Search transactions, plans…') }}" aria-label="{{ $tx('Search') }}"
                    x-model="q" @input.debounce.300ms="run()" @focus="open = true" @keydown.escape="open = false">
                <div class="dash-search-results" x-show="open && q.trim().length >= 2" x-cloak role="listbox">
                    <template x-if="loading"><p role="status">{{ $tx('Searching…') }}</p></template>
                    <template x-if="!loading && items.length === 0"><p>{{ $tx('No matching results') }}</p></template>
                    <template x-for="(item, i) in items" :key="i">
                        <a :href="item.href" role="option"><span x-text="item.kind"></span><strong x-text="item.title"></strong><small x-text="item.subtitle"></small></a>
                    </template>
                </div>
            </div>

            <div class="dash-topbar-spacer"></div>

            <div class="dash-topbar-actions">
                @include('partials.language-selector')
                <button class="dash-icon-btn" :aria-label="theme === 'light' ? @js($tx('Switch to dark mode')) : @js($tx('Switch to light mode'))" @click="toggleTheme">
                    <span x-show="theme === 'light'"><x-dash-icon name="moon" :size="18" /></span>
                    <span x-show="theme !== 'light'" x-cloak><x-dash-icon name="sun" :size="18" /></span>
                </button>

                <button class="dash-icon-btn" aria-label="{{ $tx('Notifications') }}" @click="openModal('notifications')">
                    <x-dash-icon name="bell" :size="18" />
                    <span class="dash-badge" x-show="notifUnread > 0" x-text="notifUnread" x-cloak></span>
                </button>

                <div style="position:relative">
                    <button class="dash-user-chip" :aria-expanded="menuOpen" aria-label="{{ $tx('Account menu') }}" @click="menuOpen = !menuOpen">
                        <img src="{{ $u['avatarUrl'] ?? '/avatars/avatar1.jpg' }}" alt="{{ $u['name'] ?? '' }}">
                        <span>
                            <span class="dash-user-chip-name">{{ $u['name'] ?? '' }}</span><br>
                            <span class="dash-user-chip-venue">{{ $u['memberSince'] ?? '' }}</span>
                        </span>
                        <x-dash-icon name="chevron-down" :size="14" />
                    </button>
                    <div class="dash-user-menu" x-show="menuOpen" x-cloak @click.outside="menuOpen = false">
                        <a href="/user/user/dashboard">{{ $tx('Dashboard') }}</a>
                        <a href="/">{{ $tx('View Public Site') }}</a>
                        <a href="/user/user/dashboard/settings">{{ $tx('Account settings') }}</a>
                        <button type="button" class="dash-user-menu-item" @click="openModal('profile')">{{ $tx('My Profile') }}</button>
                        <button class="dash-user-menu-danger" @click="logout" :disabled="busy"><x-dash-icon name="log-out" :size="15" /> {{ $tx('Logout') }}</button>
                    </div>
                </div>
            </div>
        </header>

        <main class="dash-body">
            @yield('dash-content')
        </main>
    </div>

    {{-- ---------- Notifications modal ---------- --}}
    <div class="dash-modal-overlay" x-show="modal === 'notifications'" x-cloak @click.self="closeModal()">
        <div class="dash-modal" role="dialog" aria-modal="true" :aria-label="@js($tx('Notifications'))">
            <div class="dash-modal-head">
                <h3>{{ $tx('Notifications') }}</h3>
                <button class="dash-modal-close" aria-label="{{ $tx('Close') }}" @click="closeModal()"><x-dash-icon name="close" /></button>
            </div>
            <div class="dash-modal-body dash-notif-panel">
                <button type="button" class="dash-btn ghost" @click="closeModal()">{{ $tx('Back to dashboard') }}</button>
                <template x-if="notifItems.length === 0">
                    <div class="dash-notice">
                        <x-dash-icon name="info" :size="16" />
                        <span>{{ $tx('You have no notifications yet.') }}</span>
                    </div>
                </template>
                <ul class="dash-notif-list" x-show="notifItems.length > 0" x-cloak>
                    <template x-for="n in notifItems" :key="n.id">
                        <li :class="n.read ? 'read' : ''">
                            <button type="button" class="dash-btn ghost" x-show="!n.read" :disabled="busy" @click="readNotification(n)">{{ $tx('Mark as read') }}</button>
                            <b x-text="n.title"></b>
                            <span x-show="n.body" x-text="n.body"></span>
                            <small x-text="n.time"></small>
                            <a class="dash-section-link" x-show="n.link && n.link.startsWith('/') && !n.link.startsWith('//')" :href="n.link">{{ $tx('View details') }}</a>
                        </li>
                    </template>
                </ul>
                <button type="button" class="dash-btn ghost block" x-show="notifUnread > 0" x-cloak
                    :disabled="busy" @click="markAllNotificationsRead()">
                    <template x-if="busy">
                        <span>{{ $tx('Marking as read…') }}</span>
                    </template>
                    <template x-if="!busy"><span>
                        <x-dash-icon name="check" :size="14" />
                        <span>{{ $tx('Mark all as read') }}</span>
                    </span></template>
                </button>
            </div>
        </div>
    </div>

    @php
        $payout = $overview['payout'] ?? [];
        $plans = $overview['plans'] ?? [];
        $defaultPlanId = collect($plans)->firstWhere('id', request('plan'))['id'] ?? ($plans[0]['id'] ?? '');
    @endphp

    {{-- ---------- Deposit (x-if so nested Alpine form mounts when opened) ---------- --}}
    <template x-if="modal === 'deposit'">
    <div class="dash-modal-overlay" @click.self="closeModal()">
        <div class="dash-modal wide" role="dialog" aria-modal="true" aria-label="{{ $tx('Add Funds') }}">
        <div x-data="depositFundsForm(@js(['payout' => $payout]))" :aria-busy="busy">
            <div class="dash-modal-head">
                <h3>{{ $tx('Add Funds') }}</h3>
                <button type="button" class="dash-modal-close" aria-label="{{ $tx('Close') }}" @click="$dispatch('dash-close-modal')"><x-dash-icon name="close" /></button>
            </div>
            <div class="fund-tabs" aria-label="{{ $tx('Funding method') }}">
                <button type="button" :aria-pressed="mode === 'CRYPTO'" @click="mode = 'CRYPTO'; error = ''; if (!intent) submitted = false">{{ $tx('Crypto') }}</button>
                <button type="button" :aria-pressed="mode === 'BANK'" @click="mode = 'BANK'; error = ''">{{ $tx('Bank Transfer') }}</button>
            </div>
            <div class="dash-modal-body fund-form" x-show="mode === 'BANK'" x-cloak>
                <template x-if="submitted">
                    <div class="dash-payto-success">
                        <h3>{{ $tx('Deposit request submitted') }}</h3>
                        <span class="dash-tx-status" data-status="pending">{{ $tx('Pending review') }}</span>
                        <p>{{ $tx("Send the payment below and we'll credit your balance once it's confirmed. Keep your reference") }} <b x-text="bankRef"></b> handy.</p>
                        <div class="dash-payto">
                            <div class="dash-form-group">
                                <label for="dep-ref-done">{{ $tx('Your deposit reference') }}</label>
                                <div class="dash-payto-line">
                                    <code class="dash-payto-code" id="dep-ref-done" x-text="bankRef"></code>
                                    <button type="button" class="dash-btn ghost dash-payto-copy" @click="copyPayto('ref', bankRef)" x-text="copiedKey === 'ref' ? @js($tx('Copied')) : @js($tx('Copy'))"></button>
                                </div>
                            </div>
                            <div x-show="bankTransfer" x-cloak>
                                <div class="dash-payto-title">{{ $tx('Pay to') }}</div>
                                <template x-for="it in (bankTransfer?.items || [])" :key="it.label">
                                    <div class="dash-payto-line">
                                        <span class="dash-payto-label" x-text="it.label"></span>
                                        <code class="dash-payto-code" x-text="it.value"></code>
                                        <button type="button" class="dash-btn ghost dash-payto-copy" @click="copyPayto(it.label, it.value)" x-text="copiedKey === it.label ? @js($tx('Copied')) : @js($tx('Copy'))"></button>
                                    </div>
                                </template>
                            </div>
                        </div>
                        <button type="button" class="dash-btn primary block" @click="finishBankDeposit()">{{ $tx('Done') }}</button>
                    </div>
                </template>
                <template x-if="!submitted">
                    <div>
                        <div class="dash-form-group">
                            <label for="dep-method">{{ $tx('Deposit Method') }}</label>
                            <select id="dep-method" class="dash-select" x-model="method" disabled>
                                <option value="Bank Transfer">{{ $tx('Bank Transfer') }}</option>
                            </select>
                        </div>
                        <div class="dash-form-group">
                            <label for="dep-amount">{{ $tx('Amount') }}</label>
                            <div class="dash-input-suffix">
                                <input id="dep-amount" class="dash-input" inputmode="decimal" placeholder="100.00" x-model="amount" :disabled="busy">
                                <span>USD</span>
                            </div>
                        </div>
                        <p class="dash-input-note">{{ $tx('Your balance updates after the payment is confirmed.') }}</p>
                        <div class="dash-payto">
                            <div class="dash-form-group">
                                <label for="dep-ref">{{ $tx('Your deposit reference') }}</label>
                                <div class="dash-payto-line">
                                    <code class="dash-payto-code" id="dep-ref" x-text="bankRef"></code>
                                    <button type="button" class="dash-btn ghost dash-payto-copy" @click="copyPayto('ref', bankRef)" x-text="copiedKey === 'ref' ? @js($tx('Copied')) : @js($tx('Copy'))"></button>
                                </div>
                            </div>
                            <div x-show="bankTransfer" x-cloak>
                                <div class="dash-payto-title">{{ $tx('Pay to') }}</div>
                                <template x-for="it in (bankTransfer?.items || [])" :key="it.label">
                                    <div class="dash-payto-line">
                                        <span class="dash-payto-label" x-text="it.label"></span>
                                        <code class="dash-payto-code" x-text="it.value"></code>
                                        <button type="button" class="dash-btn ghost dash-payto-copy" @click="copyPayto(it.label, it.value)" x-text="copiedKey === it.label ? @js($tx('Copied')) : @js($tx('Copy'))"></button>
                                    </div>
                                </template>
                                <p class="dash-input-note">{{ $tx('Include your reference (') }}<b x-text="bankRef"></b>{{ $tx(') in the payment description so we can match it to your account. Deposits are credited once confirmed.') }}</p>
                            </div>
                            <p class="dash-input-note" x-show="!bankTransfer" x-cloak>{{ $tx("Payment instructions for Bank Transfer aren't set up yet — please contact support.") }}</p>
                        </div>
                        <template x-if="error"><p class="dash-form-error" role="alert" x-text="error"></p></template>
                        <button type="button" class="dash-btn primary block" :disabled="busy" @click="submitBank()">
                            <span x-text="busy ? @js($tx('Submitting deposit…')) : @js($tx('Submit Deposit Request'))"></span>
                        </button>
                    </div>
                </template>
            </div>
            <div class="dash-modal-body fund-form" x-show="mode === 'CRYPTO'" x-cloak>
                <p class="dash-form-error" role="alert" x-show="error" x-text="error"></p>
                <div x-show="!intent">
                    <p class="dash-input-note" role="status" x-show="!funds && !error">{{ $tx('Loading balances…') }}</p>
                    <p class="dash-notice" x-show="funds && depositWallets.length === 0">{{ $tx('Crypto deposits are not configured yet.') }}</p>
                    <div x-show="funds && depositWallets.length > 0">
                        <div class="dash-form-group"><label for="crypto-wallet">{{ $tx('Asset and network') }}</label>
                            <select id="crypto-wallet" class="dash-select" x-model="walletId" :disabled="busy" @change="depReference = ''">
                                <template x-for="w in depositWallets" :key="w.id">
                                    <option :value="w.id" x-text="walletOptionLabel(w)"></option>
                                </template>
                            </select>
                        </div>
                        <div class="dash-form-group"><label for="crypto-quantity">{{ $tx('Crypto quantity') }}</label>
                            <input id="crypto-quantity" class="dash-input" inputmode="decimal" dir="ltr" x-model="quantity" :disabled="busy" @input="depReference = ''">
                        </div>
                        <p class="dash-input-note">{{ $tx('Your crypto quantity is credited after the transfer is reviewed. Its USD value is fixed only when you invest.') }}</p>
                        <button type="button" class="dash-btn primary block" :disabled="busy || !activeWallet || !quantity.trim()" @click="createCryptoIntent()">
                            <span x-text="busy ? @js($tx('Preparing deposit…')) : @js($tx('Get deposit instructions'))"></span>
                        </button>
                    </div>
                    <div class="fund-pending" x-show="funds && pendingDeposits().length">
                        <h3>{{ $tx('Continue a deposit') }}</h3>
                        <template x-for="item in pendingDeposits()" :key="item.id">
                            <button type="button" class="fund-resume" @click="resume(item)">
                                <span><bdi x-text="item.quantity + ' ' + item.symbol"></bdi><small x-text="item.network"></small></span>
                                <span x-text="item.txHash ? @js($tx('Pending review')) + ' →' : @js($tx('Pending')) + ' →'"></span>
                            </button>
                        </template>
                    </div>
                </div>
                <template x-if="intent">
                <div class="fund-crypto-intent">
                    <button type="button" class="dash-btn ghost fund-step-back" :disabled="busy" @click="backToDeposits()">
                        <x-dash-icon name="arrow-down" class="fund-back-arrow" :size="16" /> {{ $tx('Back to deposits') }}
                    </button>
                    <div class="fund-transfer-heading"><strong><bdi x-text="intent.quantity + ' ' + intent.symbol"></bdi></strong><span x-text="intent.network"></span></div>
                    <div class="fund-address"><span>{{ $tx('Receiving address') }}</span><code dir="ltr" x-text="intent.receivingAddress"></code>
                        <button type="button" class="dash-btn ghost" @click="copyAddress()" x-text="copied ? @js($tx('Copied')) : @js($tx('Copy'))"></button>
                    </div>
                    <div class="fund-address" x-show="intent.destinationTag != null">
                        <span>{{ $tx('XRP destination tag') }}</span><code dir="ltr" x-text="intent.destinationTag"></code>
                        <p class="dash-input-note">{{ $tx('Include this destination tag with the transfer.') }}</p>
                    </div>
                    <p class="dash-input-note" x-text="tx('Send only {symbol} on {network} to this address.', { symbol: intent.symbol, network: intent.network })"></p>
                    <p class="dash-input-note">{{ $tx('Deposit reference') }}: <code x-text="intent.reference"></code></p>
                    <div class="fund-confirmation" role="status" x-show="cryptoDepositConfirmed()">
                        <strong x-text="tx(intentStatus() === 'APPROVED' ? 'Deposit confirmed' : intentStatus() === 'REJECTED' ? 'Deposit rejected' : 'Pending review')"></strong>
                        <p x-text="tx(intentStatus() === 'APPROVED' ? 'The deposit is confirmed and the account balance has been updated.' : intentStatus() === 'REJECTED' ? 'Your deposit request was rejected.' : 'Your deposit is saved for manual review. Your balance will update after admin confirmation.')"></p>
                        <p x-show="currentIntent()?.adminNote" x-text="currentIntent()?.adminNote"></p>
                        <a href="/user/user/dashboard/transactions">{{ $tx('Transaction History') }}</a>
                        <a x-show="explorerUrl()" :href="explorerUrl()" target="_blank" rel="noreferrer">{{ $tx('View blockchain transaction ↗') }}</a>
                    </div>
                    <div class="fund-crypto-submit" x-show="cryptoDepositEditable()">
                        <button type="button" class="dash-btn primary block" x-show="depositAsset && depositAsset.chainId && !hash && !uncertain" :disabled="busy" @click="payWithWallet()">
                            <span x-text="busy ? @js($tx('Confirm in your wallet…')) : @js($tx('Pay with connected wallet'))"></span>
                        </button>
                        <div x-show="uncertain">
                            <p class="dash-input-note">{{ $tx('Check your wallet before sending again. If a transfer was sent, paste its transaction hash below.') }}</p>
                            <button type="button" class="dash-btn ghost block" :disabled="busy" @click="clearUncertain()">{{ $tx('No transfer was sent — try again') }}</button>
                        </div>
                        <div class="dash-form-group"><label for="crypto-txhash">{{ $tx('Transaction hash (optional)') }}</label>
                            <input id="crypto-txhash" class="dash-input" dir="ltr" autocomplete="off" maxlength="100" x-model="hash" :disabled="busy">
                            <p id="deposit-hash-hint" class="dash-input-note">{{ $tx('You can submit this deposit for manual review without a transaction hash.') }}</p>
                        </div>
                        <button type="button" id="crypto-submit-deposit" class="dash-btn primary block" :disabled="busy" @click="submitCryptoDeposit()">
                            <span x-text="busy ? @js($tx('Submitting deposit…')) : @js($tx('Submit deposit request'))"></span>
                        </button>
                        <p class="dash-input-note">{{ $tx('You can submit without a transaction hash. Add a hash if you already sent the transfer.') }}</p>
                    </div>
                    <button type="button" class="dash-btn primary block" x-show="showCryptoDone()" @click="finishCryptoDeposit()">{{ $tx('Done') }}</button>
                    <div class="fund-qr-block" x-effect="drawQr()">
                        <div class="fund-qr"><canvas x-ref="depositQr" @resize.window.debounce.150ms="drawQr()" aria-label="{{ $tx('Receiving address QR code') }}"></canvas></div>
                        <button type="button" class="dash-btn ghost" @click="downloadQr()">{{ $tx('Download QR code') }}</button>
                    </div>
                </div>
                </template>
            </div>
        </div>
        </div>
    </div>
    </template>

    {{-- ---------- Withdraw ---------- --}}
    <template x-if="modal === 'withdraw'">
    <div class="dash-modal-overlay" @click.self="closeModal()">
        <div class="dash-modal wide" role="dialog" aria-modal="true" x-data="withdrawFundsForm()">
            <div class="dash-modal-head"><h3>{{ $tx('Make New withdrawal') }}</h3><button class="dash-modal-close" aria-label="{{ $tx('Close') }}" @click="closeModal()"><x-dash-icon name="close" /></button></div>
            <div class="fund-tabs" aria-label="{{ $tx('Funding method') }}">
                <button type="button" :aria-pressed="mode === 'CRYPTO'" @click="mode = 'CRYPTO'; error = ''">{{ $tx('Crypto') }}</button>
                <button type="button" :aria-pressed="mode === 'BANK'" @click="mode = 'BANK'; error = ''">{{ $tx('Bank Transfer') }}</button>
            </div>
            <div class="dash-modal-body" x-show="mode === 'BANK'" x-cloak>
                <template x-if="!done">
                    <div>
                        <div class="dash-form-group"><label>{{ $tx('Withdraw To') }}</label>
                            <select class="dash-select" x-model="method">
                                <option value="Bank Transfer">{{ $tx('Bank Transfer') }}</option>
                            </select>
                        </div>
                        <div class="dash-form-group"><label>{{ $tx('Amount') }}</label><div class="dash-input-suffix"><input class="dash-input" inputmode="decimal" placeholder="100.00" x-model="amount"><span>USD</span></div>
                            <p class="dash-input-note">{{ $tx('Available:') }} <b>{{ $overview['balance']['available'] ?? '$0.00' }}</b> {{ $tx('— you can\'t withdraw more than this.') }}</p></div>
                        <div class="dash-form-group"><label>Bank / Account or Wallet Details</label><input class="dash-input" placeholder="{{ $tx('e.g. account number, SWIFT, wallet address') }}" x-model="details"></div>
                        <template x-if="error"><p class="dash-form-error" x-text="error"></p></template>
                        <button class="dash-btn primary block" :disabled="busy" @click="submitBank()"><span x-text="busy ? 'Submitting…' : 'Request Withdrawal'"></span></button>
                    </div>
                </template>
                <template x-if="done">
                    <div class="dash-payto-success"><h3>Withdrawal requested</h3><span class="dash-tx-status" data-status="pending">{{ $tx('Pending review') }}</span><p>Your request is under review. Funds are reserved until it's processed.</p><button class="dash-btn primary block" @click="location.reload()">{{ $tx('Done') }}</button></div>
                </template>
            </div>
            <div class="dash-modal-body fund-form" x-show="mode === 'CRYPTO'" x-cloak>
                <template x-if="funds && funds.features && !funds.features.cryptoWithdrawals"><p class="dash-notice" role="status">{{ $tx('Crypto withdrawals are temporarily unavailable.') }}</p></template>
                <template x-if="error"><p class="dash-form-error" x-text="error"></p></template>
                <template x-if="saved">
                    <div class="fund-confirmation" role="status"><strong>{{ $tx('Withdrawal submitted') }}</strong>
                        <p>Your funds are reserved while the withdrawal is reviewed.</p>
                        <p x-show="currentRequest()?.reference">Reference: <code x-text="currentRequest()?.reference"></code></p>
                        <a href="/user/user/dashboard/withdrawals">{{ $tx('View withdrawal details') }}</a>
                    </div>
                </template>
                <template x-if="!saved">
                    <div>
                    <template x-if="!funds"><p class="dash-input-note">{{ $tx('Loading balances…') }}</p></template>
                    <fieldset class="dash-form-fieldset" :disabled="busy || !!quote || !funds || funds?.features?.cryptoWithdrawals === false">
                        <div class="dash-form-group"><label for="withdraw-source">{{ $tx('Withdraw from') }}</label>
                            <select id="withdraw-source" class="dash-select" x-model="source" @change="wdAmount = ''; resetQuote()">
                                <option value="USD" x-text="'USD account · ' + (funds?.usd?.available ?? '—')"></option>
                                <option value="CRYPTO">{{ $tx('Crypto balance') }}</option>
                            </select>
                        </div>
                        <div class="dash-form-group"><label for="withdraw-asset">{{ $tx('Asset and network') }}</label>
                            <select id="withdraw-asset" class="dash-select" x-model="assetKey" @change="wdAmount = ''; address = ''; resetQuote()">
                                <template x-for="item in (funds?.holdings || [])" :key="item.assetKey">
                                    <option :value="item.assetKey" x-text="item.symbol + ' · ' + item.network + ' — Available: ' + item.available + ' ' + item.symbol"></option>
                                </template>
                            </select>
                        </div>
                        <div class="dash-form-group"><label for="withdraw-quantity" x-text="source === 'USD' ? 'USD amount' : 'Crypto quantity'"></label>
                            <input id="withdraw-quantity" class="dash-input" inputmode="decimal" dir="ltr" x-model="wdAmount" @input="resetQuote()">
                            <button type="button" class="dash-btn ghost fund-withdraw-max" @click="useMax()">{{ $tx('Use available balance') }}</button>
                        </div>
                        <div class="dash-form-group"><label for="withdraw-address">{{ $tx('Receiving address') }}</label>
                            <input id="withdraw-address" class="dash-input" dir="ltr" x-model="address" @input="resetQuote()">
                        </div>
                        <template x-if="assetKey === 'XRP'">
                            <div class="dash-form-group"><label for="withdraw-tag">{{ $tx('XRP destination tag') }}</label>
                                <input id="withdraw-tag" class="dash-input" dir="ltr" x-model="destinationTag" @input="resetQuote()">
                            </div>
                        </template>
                    </fieldset>
                    <template x-if="quote">
                        <div class="fund-quote"><div><span>{{ $tx('Crypto quantity') }}</span><strong x-text="quote.quantity + ' ' + quote.symbol"></strong></div>
                            <div><span>{{ $tx('USD value') }}</span><strong x-text="quote.amount"></strong></div>
                            <p x-text="quoteSeconds() === 0 ? 'Quote expired. Request a new quote.' : 'Quote valid for ' + quoteSeconds() + ' seconds'"></p>
                        </div>
                    </template>
                    <button class="dash-btn primary block" :disabled="busy || !funds || !wdAmount.trim() || !address.trim() || funds?.features?.cryptoWithdrawals === false || (!!quote && quoteSeconds() === 0)" @click="submitCrypto()">
                        <span x-text="busy ? 'Working…' : (quote ? 'Confirm withdrawal' : 'Review withdrawal')"></span>
                    </button>
                    <button type="button" class="dash-btn ghost block" x-show="quote" :disabled="busy" @click="resetQuote()">{{ $tx('Edit or refresh quote') }}</button>
                    </div>
                </template>
            </div>
        </div>
    </div>
    </template>

    {{-- ---------- Invest ---------- --}}
    <template x-if="modal === 'invest'">
    <div class="dash-modal-overlay" @click.self="closeModal()">
        <div class="dash-modal" role="dialog" aria-modal="true" x-data="investForm(@js(['defaultPlanId' => $defaultPlanId]))">
            <div class="dash-modal-head"><button type="button" class="dash-btn ghost" :disabled="busy" @click="quote && !uncertain ? resetQuote() : $dispatch('dash-close-modal')">{{ $tx('Back') }}</button><h3>{{ $tx('Start New Investment') }}</h3><button type="button" class="dash-modal-close" aria-label="{{ $tx('Close') }}" @click="$dispatch('dash-close-modal')"><x-dash-icon name="close" /></button></div>
            <div class="dash-modal-body">
                <div x-show="!done">
                    <div class="dash-form-group"><label>{{ $tx('Select Plan') }}</label>
                        <div style="display:flex;flex-direction:column;gap:8px">
                            @forelse ($plans as $p)
                                <button type="button" @click="planId = @js($p['id']); resetQuote()" :disabled="busy || !!quote || uncertain"
                                    :aria-pressed="planId === @js($p['id'])" :style="{ border: planId === @js($p['id']) ? '1px solid var(--dash-lime-2)' : '1px solid var(--dash-border)', background: planId === @js($p['id']) ? 'rgba(206,255,12,0.07)' : 'rgba(255,255,255,0.04)' }"
                                    style="display:flex;gap:12px;padding:12px 14px;border-radius:12px;text-align:start;width:100%;cursor:pointer;color:inherit;font:inherit">
                                    <span style="flex:1;min-width:0">
                                        <b style="font-size:13.5px;display:block">{{ $p['name'] }}</b>
                                        <span style="font-size:12px;color:var(--dash-muted)">{{ $p['roi'] }} · {{ $p['term'] }} · Paid {{ ($p['payoutInterval'] ?? '') === 'HOURLY' ? 'hourly' : 'monthly' }}</span>
                                        <span style="display:block;margin-top:4px;font-size:13px;font-weight:600;color:var(--dash-lime-2)">{{ $p['min'] }}@if (!empty($p['max'])) – {{ $p['max'] }}@endif</span>
                                    </span>
                                </button>
                            @empty
                                <p class="dash-input-note">{{ $tx('No investment plans are available right now.') }}</p>
                            @endforelse
                        </div>
                    </div>
                    @foreach ($plans as $plan)
                        <details class="dash-position-prose" x-show="planId === @js($plan['id'])" style="margin-bottom:20px">
                            <summary>{{ $tx('Investment terms') }}</summary>
                            @if (!empty($plan['description']))<p dir="auto">{{ $plan['description'] }}</p>@endif
                            <p>{{ $tx(($plan['payoutInterval'] ?? '') === 'HOURLY' ? 'Credited to available balance hourly' : 'Accrued hourly; credited on each monthly anniversary') }}</p>
                            <p>{{ $tx(($plan['principalRelease'] ?? '') === 'AUTOMATIC' ? 'Principal is returned to your available balance automatically after the plan term.' : 'Principal is locked for the plan term, then released to available balance after admin approval. Early exit is not available.') }}</p>
                            @if (!empty($plan['terms']))<p style="white-space:pre-wrap" dir="auto">{{ $plan['terms'] }}</p>@endif
                            @if (!empty($plan['riskDisclosure']))<h4>{{ $tx('Risk disclosure') }}</h4><p style="white-space:pre-wrap" dir="auto">{{ $plan['riskDisclosure'] }}</p>@endif
                            @foreach ($plan['documents'] ?? [] as $document)<p><a href="{{ $document['fileUrl'] }}" target="_blank" rel="noreferrer">{{ $document['title'] }} ↗</a></p>@endforeach
                        </details>
                    @endforeach
                    <fieldset class="dash-form-fieldset" :disabled="busy || !!quote || uncertain">
                        <p class="dash-input-note" x-show="loadingFunds" role="status">{{ $tx('Loading available balances…') }}</p>
                        <button type="button" class="dash-btn ghost" x-show="!funds && !loadingFunds" @click="loadFunds(true)">{{ $tx('Retry loading balances') }}</button>
                        <div class="dash-form-group"><label for="investment-source">{{ $tx('Fund investment from') }}</label>
                            <select id="investment-source" class="dash-select" x-model="source" @change="sourceChanged()" :disabled="!funds">
                                <option value="USD" x-text="'USD account · ' + (funds?.usd?.available ?? '—')"></option>
                                <template x-for="asset in sources" :key="asset.assetKey"><option :value="asset.assetKey" x-text="asset.symbol + ' · ' + asset.network + ' — ' + formatCryptoQuantity(asset.available, document.documentElement.lang) + ' ≈ ' + (asset.availableUsd ?? 'USD unavailable')"></option></template>
                            </select>
                            <p class="dash-input-note">{{ $tx('Available') }}: <b x-text="available"></b><span x-show="source !== 'USD'" x-text="' ≈ ' + availableUsd"></span></p>
                            <p class="dash-input-note" x-show="source !== 'USD'">{{ $tx('Invest directly from this crypto balance. No separate swap to USD is required. Principal and returns are fixed in USD when confirmed.') }}</p>
                        </div>
                        <div class="dash-form-group" x-show="source !== 'USD'"><label for="investment-unit">{{ $tx('Enter investment in') }}</label><select id="investment-unit" class="dash-select" x-model="amountUnit" @change="unitChanged()"><option value="USD">USD</option><option value="CRYPTO" x-text="asset?.symbol || 'Crypto'"></option></select></div>
                        <div class="dash-form-group"><label for="investment-amount">{{ $tx('Investment Amount') }}</label><div class="dash-input-suffix"><input id="investment-amount" class="dash-input" inputmode="decimal" placeholder="100.00" x-model="amount" @input="resetQuote()"><span x-text="source === 'USD' || amountUnit === 'USD' ? 'USD' : asset?.symbol"></span></div></div>
                    </fieldset>
                    <div class="fund-quote investment-preview" x-show="estimate && !quote" aria-live="polite">
                        <div><span>{{ $tx('Estimated USD principal') }}</span><strong x-text="estimate?.amount"></strong></div>
                        <div><span>{{ $tx('Crypto to invest') }}</span><strong x-text="(estimate?.quantity || '') + ' ' + (asset?.symbol || '')"></strong></div>
                        <p>{{ $tx('Estimate only. Review locks a fresh price before confirmation.') }}</p>
                        <p class="dash-form-error" x-show="exceedsEstimate">{{ $tx('This exceeds your available balance. Reduce the amount or fund your account.') }}</p>
                    </div>
                    <p class="dash-input-note" x-show="source !== 'USD' && amount && !estimate && !quote">{{ $tx('A USD estimate is unavailable. Review will request a fresh price.') }}</p>
                    <div class="fund-quote" x-show="quote" x-cloak role="status">
                        <p>{{ $tx('Investment principal') }}: <strong x-text="quote?.amount"></strong></p>
                        <p x-show="quote?.quantity"><span>{{ $tx('Crypto to use') }}: </span><bdi x-text="(quote?.quantity ?? '') + ' ' + (asset?.symbol ?? '')"></bdi></p>
                        <p x-show="seconds !== null">{{ $tx('Quote expires in') }} <span x-text="seconds"></span>s</p>
                        <p class="dash-input-note">{{ $tx('Only the confirmed amount is invested. Your remaining funds stay available to invest or withdraw.') }}</p>
                    </div>
                    <p class="dash-form-error" role="alert" x-show="error" x-text="error"></p>
                    <p class="dash-input-note" x-show="uncertain">{{ $tx('The request may have reached the server. Check its status before starting another investment.') }}</p>
                    <button type="button" class="dash-btn primary block" :disabled="busy || !planId || !funds || (!uncertain && expired)" @click="submit()"><span class="action-spinner" x-show="busy" aria-hidden="true"></span><span x-text="busy ? @js($tx('Working…')) : uncertain ? @js($tx('Check investment request')) : quote ? @js($tx('Confirm investment')) : @js($tx('Review investment'))"></span></button>
                    <button type="button" class="dash-btn ghost block" x-show="quote && !uncertain" :disabled="busy" @click="resetQuote()">{{ $tx('Edit or refresh quote') }}</button>
                    <div class="dash-actions-row" x-show="needsFunds && !uncertain"><button type="button" class="dash-btn ghost" @click="$dispatch('dash-close-modal')">{{ $tx('Cancel') }}</button><button type="button" class="dash-btn primary" @click="$dispatch('dash-open-modal', 'deposit')">{{ $tx('Fund Account') }}</button></div>
                </div>
                <div class="dash-payto-success" x-show="done" x-cloak>
                    <h3>{{ $tx('Investment started') }}</h3>
                    <p>{{ $tx('Your investment is active. Profit accrues per the plan terms.') }}</p>
                    <button type="button" class="dash-btn primary block" @click="finish()">{{ $tx('Done') }}</button>
                </div>
            </div>
        </div>
    </div>
    </template>

    {{-- ---------- Cards ---------- --}}
    <template x-if="modal === 'cards'"><div class="dash-modal-overlay" @click.self="closeModal()"><div class="dash-modal" role="dialog" aria-modal="true" x-data="cardManager()">
        <div class="dash-modal-head"><h3>{{ $tx('Manage Cards') }}</h3><button type="button" class="dash-modal-close" aria-label="{{ $tx('Close') }}" @click="closeModal()"><x-dash-icon name="close" /></button></div>
        <div class="dash-modal-body"><p x-show="loading" role="status">{{ $tx('Loading…') }}</p><p x-show="error" x-text="error" class="dash-form-error" role="alert"></p><p x-show="message" x-text="message" role="status"></p>
            <template x-for="card in cards" :key="card.id"><section class="dash-card dash-card-pad"><h4 x-text="card.brand + ' •••• ' + card.last4"></h4><p x-text="card.holder + ' · ' + card.status + (card.isDefault ? ' · Default' : '')"></p>
                <div class="dash-actions-row"><button type="button" class="dash-btn ghost" :disabled="!!busy || card.status === 'EXPIRED'" @click="act(card.id, card.status === 'FROZEN' ? 'UNFREEZE' : 'FREEZE')" x-text="busy === card.id ? 'Saving…' : card.status === 'FROZEN' ? 'Unfreeze card' : 'Freeze card'"></button><button type="button" class="dash-btn ghost" :disabled="!!busy || card.isDefault || card.status === 'EXPIRED'" @click="act(card.id, 'SET_DEFAULT')">{{ $tx('Set default') }}</button></div>
            </section></template><p x-show="!loading && !cards.length">{{ $tx('No cards yet.') }}</p><button type="button" class="dash-btn ghost block" @click="closeModal()">{{ $tx('Back to dashboard') }}</button>
        </div>
    </div></div></template>

    <template x-if="modal === 'reviewForm'"><div class="dash-modal-overlay" @click.self="closeModal()"><div class="dash-modal" role="dialog" aria-modal="true" x-data="reviewForm()">
        <div class="dash-modal-head"><h3>{{ $tx('Write a review') }}</h3><button type="button" class="dash-modal-close" aria-label="{{ $tx('Close') }}" @click="closeModal()"><x-dash-icon name="close" /></button></div>
        <form class="dash-modal-body" @submit.prevent="submit()"><fieldset class="dash-form-fieldset" :disabled="busy || done"><div class="dash-form-group"><label for="review-rating">{{ $tx('Rating') }}</label><select id="review-rating" class="dash-select" x-model.number="rating">@foreach ([5,4,3,2,1] as $rating)<option value="{{ $rating }}">{{ $rating }} ★</option>@endforeach</select></div><div class="dash-form-group"><label for="review-text">{{ $tx('Your review') }}</label><textarea id="review-text" class="dash-input" x-model="text" minlength="10" maxlength="2000" required></textarea></div><button type="submit" class="dash-btn primary block" x-show="!done" x-text="busy ? 'Submitting…' : 'Submit review'"></button></fieldset><p class="dash-form-error" x-text="error" x-show="error" role="alert"></p><div class="dash-success-message" x-show="done" role="status">{{ $tx('Your review was submitted for admin approval.') }}</div><button type="button" class="dash-btn ghost block" @click="closeModal()">{{ $tx('Done') }}</button></form>
    </div></div></template>
    <template x-if="modal === 'reviewList'"><div class="dash-modal-overlay" @click.self="closeModal()"><div class="dash-modal" role="dialog" aria-modal="true" x-data="reviewList()"><div class="dash-modal-head"><h3>{{ $tx('Reviews') }}</h3><button type="button" class="dash-modal-close" aria-label="{{ $tx('Close') }}" @click="closeModal()"><x-dash-icon name="close" /></button></div><div class="dash-modal-body">
        @if ($overview['illustrativeReviews'] ?? false)<p class="dash-input-note">{{ $tx('Illustrative reviews') }}</p>@endif
        <p x-show="loading" role="status">{{ $tx('Loading…') }}</p><p class="dash-form-error" x-text="error" x-show="error" role="alert"></p><template x-for="review in items" :key="review.id"><article class="dash-review-card"><strong x-text="review.userName"></strong><span class="dash-review-stars" x-text="'★'.repeat(review.rating)"></span><p dir="auto" x-text="review.text"></p></article></template><button type="button" class="dash-btn ghost block" @click="closeModal()">{{ $tx('Back') }}</button>
    </div></div></div></template>

    {{-- ---------- Swap crypto ---------- --}}
    <template x-if="modal === 'swap'">
    <div class="dash-modal-overlay" @click.self="closeModal()">
        <div class="dash-modal wide" role="dialog" aria-modal="true" x-data="cryptoSwapForm()">
            <div class="dash-modal-head"><h3>{{ $tx('Swap') }}</h3><button class="dash-modal-close" aria-label="{{ $tx('Close') }}" @click="closeModal()"><x-dash-icon name="close" /></button></div>
            <div class="dash-modal-body fund-form swap-form">
                <p class="dash-input-note">Convert between your USD account and any supported crypto. Investments keep their existing terms.</p>
                <div class="fund-error" role="alert" x-show="error" x-cloak>
                    <span x-text="error"></span>
                    <button type="button" class="dash-btn ghost" :disabled="busy" @click="error = ''; loadSwaps()">{{ $tx('Retry') }}</button>
                </div>
                <p role="status" x-show="!data && !error" x-cloak>{{ $tx('Loading swaps…') }}</p>
                <div class="fund-confirmation" role="status" x-show="submitted" x-cloak>
                    <strong x-text="resultStatus === 'CANCELLED' ? 'Swap cancelled' : resultStatus === 'COMPLETED' ? 'Swap completed' : resultStatus === 'REFUNDED' ? 'Swap refunded' : 'Swap submitted'"></strong>
                    <p>Your exchange is complete. Updated balances appear on the dashboard.</p>
                </div>
                <p class="dash-notice" role="status" x-show="uncertain" x-cloak>{{ $tx('Checking a previous swap request. Retry with the same reference to avoid a duplicate exchange.') }}</p>
                <p class="dash-notice" x-show="data && !data.available && !uncertain" x-cloak>Swaps are not available yet.</p>
                <button type="button" class="dash-btn ghost block" x-show="submitted && data?.available" :disabled="busy" @click="swapAgain()" x-cloak>{{ $tx('Swap again') }}</button>
                <div x-show="!submitted && (data?.available || quote)" x-cloak>
                    <fieldset class="dash-form-fieldset" :disabled="busy || !!quote">
                        <div class="dash-form-group"><label for="swap-from">{{ $tx('Swap from') }}</label>
                            <select id="swap-from" class="dash-select" x-model="from" @change="quantity = ''; submitted = false; editQuote()">
                                <template x-for="item in fromAssets()" :key="item.assetKey">
                                    <option :value="item.assetKey" x-text="assetLabel(item.assetKey)"></option>
                                </template>
                            </select>
                        </div>
                        <div class="dash-form-group"><label for="swap-quantity" x-text="from === 'USD' ? 'USD amount' : 'Crypto quantity'"></label>
                            <input id="swap-quantity" class="dash-input" dir="ltr" inputmode="decimal" x-model="quantity" @input="editQuote()">
                        </div>
                        <p class="dash-input-note">{{ $tx('Available:') }} <bdi x-text="from === 'USD' ? (sourceHolding?.available ?? '—') : ((sourceHolding?.available ?? '—') + ' ' + (sourceHolding?.symbol ?? ''))"></bdi></p>
                        <div class="dash-form-group"><label for="swap-to">{{ $tx('Receive') }}</label>
                            <select id="swap-to" class="dash-select" x-model="to" @change="editQuote()">
                                <template x-for="item in toAssets()" :key="item.assetKey">
                                    <option :value="item.assetKey" x-text="assetLabel(item.assetKey)"></option>
                                </template>
                            </select>
                        </div>
                        <div class="dash-form-group swap-receive-field">
                            <label for="swap-receive">{{ $tx('You receive') }}</label>
                            <input id="swap-receive" class="dash-input" dir="ltr" readonly :value="receiveDisplay()" placeholder="Review the swap to see the amount">
                        </div>
                    </fieldset>
                    <div class="fund-quote swap-quote" x-show="quote" x-cloak>
                        <span>{{ $tx('You receive') }}</span>
                        <strong dir="ltr" x-text="receiveDisplay()"></strong>
                        <span x-show="destNetwork()" x-text="destNetwork()"></span>
                        <dl>
                            <div x-show="quote && quote.networkFee && quote.networkFee !== '0'"><dt>{{ $tx('Network fee included') }}</dt><dd dir="ltr" x-text="quote.networkFee + ' ' + assetSymbol(to)"></dd></div>
                            <div><dt>{{ $tx('Quote expires in') }}</dt><dd x-text="seconds + 's'"></dd></div>
                        </dl>
                    </div>
                    <button type="button" class="dash-btn primary block" id="swap-confirm" :disabled="!canSubmit()" @click="submit()">
                        <span x-text="busy ? 'Working…' : (uncertain ? 'Check swap request' : quote ? 'Confirm swap' : 'Review swap')"></span>
                    </button>
                    <button type="button" class="dash-btn ghost block" x-show="quote && !uncertain" :disabled="busy" @click="editQuote()">{{ $tx('Edit or refresh quote') }}</button>
                </div>
                <div class="dash-actions-row" x-show="submitted && resultStatus === 'COMPLETED'" x-cloak>
                    <button class="dash-btn primary" type="button" @click="useSwappedFunds('invest')">{{ $tx('Invest these funds') }}</button>
                    <button class="dash-btn ghost" type="button" @click="useSwappedFunds('withdraw')">{{ $tx('Withdraw these funds') }}</button>
                </div>
                <section class="swap-history" x-show="data?.items?.length" x-cloak>
                    <h3>{{ $tx('Swap history') }}</h3>
                    <template x-for="item in (data?.items || [])" :key="item.id">
                        <div class="dash-activity-row"><div><strong dir="ltr" x-text="item.quantity + ' ' + item.fromSymbol + ' → ' + (item.status === 'REFUNDED' ? item.refundQuantity + ' ' + item.fromSymbol : (item.receivedQuantity ?? item.quotedQuantity) + ' ' + item.toSymbol)"></strong>
                            <small x-text="item.reference"></small></div>
                            <div><span class="dash-tx-status" :data-status="item.status.toLowerCase()" x-text="statusLabel(item.status)"></span></div>
                        </div>
                    </template>
                </section>
            </div>
        </div>
    </div>
    </template>

    {{-- ---------- Loan application ---------- --}}
    <template x-if="modal === 'loanApply'">
    <div class="dash-modal-overlay" @click.self="closeModal()">
        <div class="dash-modal" role="dialog" aria-modal="true" x-data="loanApplyForm()">
            <div class="dash-modal-head"><h3>{{ $tx('Loan Application') }}</h3><button class="dash-modal-close" aria-label="{{ $tx('Close') }}" @click="closeModal()"><x-dash-icon name="close" /></button></div>
            <div class="dash-modal-body">
                <template x-if="!done">
                    <div>
                        <div class="dash-form-group"><label for="loan-amount">{{ $tx('Loan Amount') }}</label>
                            <div class="dash-input-suffix"><input id="loan-amount" class="dash-input" inputmode="decimal" placeholder="100.00" x-model="amount"><span>USD</span></div>
                        </div>
                        <div class="dash-form-group"><label for="loan-type">{{ $tx('Loan Type') }}</label>
                            <select id="loan-type" class="dash-select" x-model="type">
                                @foreach (['Personal Loans', 'Student Loans', 'Agricultural Loans', 'Auto Loans', 'Mortgage Loans', 'Business Loans', 'Payday Loans', 'Crypto Merchant Loans', 'Stablecoin Loans', 'NFT Loans', 'Debt Consolidation Loans', 'Home Equity Loans', 'Medical Loans', 'Energy-efficient Loans'] as $lt)
                                    <option value="{{ $lt }}">{{ $tx($lt) }}</option>
                                @endforeach
                            </select>
                        </div>
                        <div class="dash-form-group"><label for="loan-period">{{ $tx('Loan Repayment Period') }}</label>
                            <select id="loan-period" class="dash-select" x-model="period">
                                @foreach (['3', '6', '12', '24'] as $p)
                                    <option value="{{ $p }}">{{ $tx('{value0} months', ['value0' => $p]) }}</option>
                                @endforeach
                            </select>
                        </div>
                        <div class="dash-form-group"><label for="loan-occ">{{ $tx('Your Occupation') }}</label>
                            <input id="loan-occ" class="dash-input" placeholder="{{ $tx('Enter your occupation') }}" x-model="occupation">
                        </div>
                        <div class="dash-form-group"><label for="loan-cur">{{ $tx('Preferred payout currency') }}</label>
                            <select id="loan-cur" class="dash-select" x-model="currency">
                                @foreach (['BTC', 'ETH', 'LTC', 'USDT (ERC20)', 'USDT (TRC20)', 'BNB', 'DOGE', 'XRP', 'XLM', 'ADA', 'QNT'] as $c)
                                    <option value="{{ $c }}">{{ $c }}</option>
                                @endforeach
                            </select>
                        </div>
                        <template x-if="error"><p class="dash-form-error" role="alert" x-text="error"></p></template>
                        <button class="dash-btn primary block" :disabled="busy" @click="submit()">
                            <span x-text="busy ? (window.__QFS_TX ? __QFS_TX('Submitting application…') : 'Submitting application…') : (window.__QFS_TX ? __QFS_TX('Apply for Loan') : 'Apply for Loan')"></span>
                        </button>
                    </div>
                </template>
                <template x-if="done">
                    <div class="dash-payto-success"><h3>{{ $tx('Loan application submitted. Status: Pending review.') }}</h3>
                        <button class="dash-btn primary block" @click="location.reload()">{{ $tx('Done') }}</button></div>
                </template>
            </div>
        </div>
    </div>
    </template>

    {{-- ---------- Profile ---------- --}}
    <div class="dash-modal-overlay" x-show="modal === 'profile'" x-cloak @click.self="closeModal()">
        <div class="dash-modal" role="dialog" aria-modal="true">
            <div class="dash-modal-head"><h3>{{ $tx('My Profile') }}</h3><button class="dash-modal-close" aria-label="{{ $tx('Close') }}" @click="closeModal()"><x-dash-icon name="close" /></button></div>
            <div class="dash-modal-body">
                <div class="dash-loan-row"><span>{{ $tx('Name') }}</span><b>{{ $u['name'] ?? '—' }}</b></div>
                <div class="dash-loan-row"><span>{{ $tx('Email') }}</span><b>{{ $u['email'] ?? '—' }}</b></div>
                <div class="dash-loan-row"><span>{{ $tx('Country') }}</span><b>{{ $u['country'] ?? '—' }}</b></div>
                <div class="dash-loan-row"><span>{{ $tx('Member since') }}</span><b>{{ $u['memberSince'] ?? '—' }}</b></div>
                <div class="dash-actions-row"><a class="dash-btn ghost" href="/user/user/connect">{{ $tx('Manage Wallet') }} <x-dash-icon name="right-arrow" :size="14" /></a></div>
            </div>
        </div>
    </div>

    <div class="dash-toast" x-show="toast" x-cloak role="status">
        <x-dash-icon name="check" :size="16" />
        <span x-text="toast"></span>
    </div>

    {{-- ---------- Fallback dialog ---------- --}}
    <div class="dash-modal-overlay" x-show="modal && !['notifications','deposit','withdraw','invest','cards','swap','loanApply','profile','reviewForm','reviewList'].includes(modal)" x-cloak @click.self="closeModal()">
        <div class="dash-modal" role="dialog" aria-modal="true">
            <div class="dash-info-dialog">
                <div class="dash-info-ico"><x-dash-icon name="info" :size="28" /></div>
                <h3 x-text="modalTitle"></h3>
                <p>{{ $tx('This action opens from the dashboard menu when configured. Use the sidebar for full account tools.') }}</p>
                <button class="dash-btn primary" @click="closeModal()">{{ $tx('Close') }}</button>
            </div>
        </div>
    </div>
</div>
</body>
</html>
