<!doctype html>
<html lang="{{ $htmlLang }}" dir="{{ $htmlDir }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $tx('Connect Wallet') }} | QFS</title>
    <meta name="robots" content="noindex">
    <link rel="icon" href="/favicon.ico">
    @include('partials.head-fonts')
    <link rel="stylesheet" href="/css/app.css">
    <link rel="stylesheet" href="/css/dashboard.css">
    <link rel="stylesheet" href="/css/wallet.css">
    <style>[x-cloak]{display:none!important}</style>
    {{-- wallet.js first so its alpine:init listener registers before Alpine boots. --}}
    <script defer src="/js/wallet.js"></script>
    <script defer src="/js/alpine.min.js"></script>
</head>
<body>
    <div class="qfs-dash" data-theme="dark">
        <div class="wc-wrap" x-data="connectWallet()">
            <a class="wc-back" href="/user/user/dashboard">← Back to dashboard</a>
            <div class="wc-head">
                <h1>{{ $tx('Connect Wallet') }}</h1>
                <p>{{ $tx('Connect your Ethereum or BNB Smart Chain wallet by signing a message. Connecting verifies ownership and never moves money on its own.') }}</p>
            </div>

            <template x-if="installed === false">
                <div class="wc-note">
                    <strong>{{ $tx('No wallet is available in this browser.') }}</strong> {{ $tx('Open this page in your wallet app, or use a browser with a wallet extension.') }}
                    <a href="https://metamask.io/download/" target="_blank" rel="noreferrer noopener">{{ $tx('Get MetaMask') }}</a>
                </div>
            </template>

            <template x-if="onWrongNetwork">
                <div class="wc-note wc-note-warn">
                    {{ $tx('Your wallet is on chain') }} <span x-text="chainId"></span>{{ $tx('. Switch to') }} <span x-text="ETH_MAINNET.name"></span> {{ $tx('to connect.') }}
                    <button type="button" class="wc-btn wc-btn-ghost" :disabled="working" @click="switchNetwork()">{{ $tx('Switch network') }}</button>
                </div>
            </template>

            <div class="wc-card">
                <template x-if="browserWallets.length > 0">
                    <label class="wc-field" for="wc-provider">{{ $tx('Choose your wallet') }}
                        <select id="wc-provider" class="wc-input" x-model="selectedWallet" :disabled="working" @change="status = { kind: 'idle' }">
                            <template x-for="wallet in browserWallets" :key="wallet.id">
                                <option :value="wallet.id" x-text="wallet.name"></option>
                            </template>
                        </select>
                    </label>
                </template>
                <div class="wc-actions">
                    <button type="button" class="wc-btn wc-btn-primary" @click="connect()" :disabled="working || installed !== true" :aria-busy="working">
                        <span x-text="wallets.length > 0 ? 'Connect another wallet' : 'Connect wallet'"></span>
                    </button>
                    <button type="button" class="wc-btn wc-btn-ghost" x-show="installed === false || (!listLoading && wallets.length === 0)" x-cloak @click="openReport()">
                        Report issue
                    </button>
                </div>

                <template x-if="status.kind === 'working'">
                    <p class="wc-status" role="status"><span class="wc-spinner" aria-hidden="true"></span><span x-text="status.step"></span></p>
                </template>
                <template x-if="status.kind === 'error'">
                    <p class="wc-status wc-status-error" role="alert" x-text="status.message"></p>
                </template>
                <template x-if="status.kind === 'done'">
                    <p class="wc-status wc-status-ok" role="status" x-text="status.message"></p>
                </template>
            </div>

            <template x-if="installed === false">
                <section class="wc-card">
                    <h2 class="wc-app-title">{{ $tx('Open in wallet app') }}</h2>
                    <p class="wc-manual-intro">{{ $tx('On your phone, open this page in MetaMask or Trust Wallet. Sign in there, then connect your wallet.') }}</p>
                    <template x-if="appLinks">
                        <div class="wc-app-links">
                            <a class="wc-btn wc-btn-ghost" :href="appLinks.metamask">{{ $tx('MetaMask ↗') }}</a>
                            <a class="wc-btn wc-btn-ghost" :href="appLinks.trust">{{ $tx('Trust Wallet ↗') }}</a>
                        </div>
                    </template>
                    <template x-if="!appLinks">
                        <p class="wc-status">{{ $tx('Use the HTTPS website address to open this page in a wallet app.') }}</p>
                    </template>
                </section>
            </template>

            <section class="wc-card wc-manual">
                <button type="button" class="wc-manual-toggle" :aria-expanded="manualOpen" aria-controls="wc-manual-form" @click="manualOpen = !manualOpen">
                    <span x-text="manualOpen ? 'Hide manual verification' : 'Automatic connection failed? Verify manually'"></span>
                </button>
                <div id="wc-manual-form" x-show="manualOpen" x-cloak>
                    <p class="wc-manual-intro">{{ $tx('Enter your public Ethereum address, sign the one-time message in your wallet, then paste the signature. Never enter your recovery phrase or private key here.') }}</p>
                    <p class="wc-manual-intro">{{ $tx('If you only have a recovery phrase, import it in your wallet app first, then return here to connect. This site will never ask you to type it.') }}</p>
                    <label class="wc-field" for="wc-address">{{ $tx('Public wallet address') }}</label>
                    <input id="wc-address" class="wc-input" autocomplete="off" spellcheck="false" placeholder="0x…"
                        x-model="manualAddress" :disabled="working" @input="manualChallenge = null; manualSignature = ''">
                    <button type="button" class="wc-btn wc-btn-ghost wc-manual-action" :disabled="working" @click="prepareManualChallenge()">{{ $tx('Generate signing message') }}</button>
                    <template x-if="manualChallenge">
                        <div>
                            <label class="wc-field" for="wc-message">{{ $tx('Sign this exact message in your wallet') }}</label>
                            <textarea id="wc-message" class="wc-input wc-message" readonly rows="9" x-text="manualChallenge.message"></textarea>
                            <button type="button" class="wc-btn wc-btn-ghost wc-manual-action" @click="copyMessage()">{{ $tx('Copy message') }}</button>
                            <label class="wc-field" for="wc-signature">{{ $tx('Signature from your wallet') }}</label>
                            <textarea id="wc-signature" class="wc-input wc-signature" autocomplete="off" spellcheck="false" placeholder="0x…"
                                rows="3" x-model="manualSignature" :disabled="working"></textarea>
                            <button type="button" class="wc-btn wc-btn-primary wc-manual-action" :disabled="working" @click="verifyManualSignature()">{{ $tx('Verify and connect') }}</button>
                        </div>
                    </template>
                </div>
            </section>

            <section class="wc-list">
                <h2>{{ $tx('Your wallets') }}</h2>
                <template x-if="listLoading">
                    <p class="wc-status" role="status">{{ $tx('Loading wallets…') }}</p>
                </template>
                <template x-if="!listLoading && listError">
                    <p class="wc-status wc-status-error" role="alert">
                        {{ $tx('Your wallets could not be loaded.') }} <button class="wc-btn wc-btn-ghost" :disabled="working" @click="load()">{{ $tx('Try again') }}</button>
                    </p>
                </template>
                <template x-if="!listLoading && !listError && wallets.length === 0">
                    <p class="wc-empty">{{ $tx('No wallets connected yet.') }}</p>
                </template>
                <template x-if="!listLoading && !listError && wallets.length > 0">
                    <ul>
                        <template x-for="w in wallets" :key="w.address">
                            <li class="wc-item">
                                <div style="min-width:0">
                                    <a class="wc-addr" :href="explorer(w.address, w.chainId)" target="_blank" rel="noreferrer noopener" :title="w.address" x-text="short(w.address)"></a>
                                    <span class="wc-meta">
                                        <span x-text="chainLabel(w.chainId)"></span><span x-text="isActiveHere(w.address) ? ' · active in this browser' : ''"></span>
                                    </span>
                                </div>
                                <button type="button" class="wc-btn wc-btn-ghost" @click="disconnect(w.address)" :disabled="working">{{ $tx('Disconnect') }}</button>
                            </li>
                        </template>
                    </ul>
                </template>
            </section>

            <p class="wc-foot">{{ $tx('Wallet verification does not authorize a payment or transfer. Withdrawal requests require separate review.') }}</p>

            <div class="wc-modal-overlay" x-show="reportOpen" x-cloak @click.self="closeReport()" @keydown.escape.window="closeReport()">
                <div class="wc-modal" role="dialog" aria-modal="true" aria-labelledby="wc-report-title">
                    <div class="wc-modal-head">
                        <h2 id="wc-report-title">Report a wallet issue</h2>
                        <button type="button" class="wc-modal-close" :disabled="reportBusy" @click="closeReport()" aria-label="{{ $tx('Close') }}">×</button>
                    </div>
                    <div class="wc-modal-body">
                        <div class="wc-status wc-status-ok" role="status" x-show="reportDone">
                            Report sent. An admin will review it and can mark it resolved.
                        </div>
                        <form x-show="!reportDone" @submit.prevent="submitReport()">
                            <p class="wc-manual-intro">Tell us what went wrong connecting your wallet. Never share a recovery phrase or private key.</p>
                            <label class="wc-field" for="wc-report-subject">What happened</label>
                            <select id="wc-report-subject" class="wc-input" x-model="reportSubject" :disabled="reportBusy">
                                <option value="WALLET_NOT_DETECTED">No wallet detected in this browser</option>
                                <option value="CONNECT_FAILED">Connect wallet is disabled or failed</option>
                                <option value="WRONG_NETWORK">Wrong network / cannot switch</option>
                                <option value="OTHER">Something else</option>
                            </select>
                            <label class="wc-field" for="wc-report-message">Describe the issue</label>
                            <textarea id="wc-report-message" class="wc-input" rows="5" maxlength="2000" x-model="reportMessage" :disabled="reportBusy" placeholder="What you tried, the wallet you use, and any error you saw."></textarea>
                            <p class="wc-status wc-status-error" role="alert" x-show="reportError" x-text="reportError"></p>
                            <div class="wc-actions">
                                <button type="submit" class="wc-btn wc-btn-primary" :disabled="reportBusy">
                                    <span x-text="reportBusy ? 'Sending…' : 'Send report'"></span>
                                </button>
                                <button type="button" class="wc-btn wc-btn-ghost" :disabled="reportBusy" @click="closeReport()">{{ $tx('Cancel') }}</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </div>
</body>
</html>
