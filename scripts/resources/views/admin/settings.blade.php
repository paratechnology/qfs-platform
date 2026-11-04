@extends('layouts.admin')
@section('title', 'Settings | QFS')
@section('admin-content')
<div x-data="{ map: {}, loading: true, error: '', saving: '', toast: '',
    async init() { try { this.map = await admGet('/api/admin/settings'); } catch (e) { this.error = e.message; } finally { this.loading = false; } },
    async save(key) { this.saving = key; this.error = ''; try { await admSend('/api/admin/settings', 'POST', { key, value: this.map[key] }); this.toast = 'Saved ' + key; setTimeout(() => this.toast = '', 2000); } catch (e) { this.error = e.message; } finally { this.saving = ''; } } }">
    <div class="adm-page-head"><div><h1>Settings</h1><p>Platform settings: deposit addresses, bank details, receiving wallets and swap configuration.</p></div></div>

    <template x-if="toast"><div class="adm-banner" role="status" x-text="toast"></div></template>
    <template x-if="error"><div class="adm-banner error" x-text="error"></div></template>

    <div x-data="admReceivingWallets()" x-init="init()" class="adm-card adm-card-pad" style="margin-bottom:20px">
        <div class="adm-wallet-heading" style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px">
            <div><h2 style="font-size:18px;margin:0 0 6px">Receiving wallets</h2><p class="adm-note">{{ $tx('Deposits go to these addresses. Existing deposit instructions keep their saved address.') }}</p></div>
            <button type="button" class="adm-btn primary" :disabled="!data || busy" @click="openEditor()">Add receiving wallet</button>
        </div>
        <template x-if="toast"><div class="adm-banner" x-text="toast"></div></template>
        <template x-if="error && !editor"><div class="adm-banner error"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">Retry</button></div></template>
        <template x-if="loading"><div class="adm-loading"><span class="adm-spinner"></span> Loading receiving wallets…</div></template>
        <template x-if="data && data.wallets.length === 0"><p class="adm-notice">Add a receiving wallet to enable crypto deposits.</p></template>
        <template x-for="wallet in (data?.wallets || [])" :key="wallet.id">
            <div class="adm-receiving-row adm-wallet-row" style="display:flex;justify-content:space-between;gap:16px;padding:14px 0;border-top:1px solid var(--dash-border)">
                <div><strong x-text="wallet.label"></strong>
                    <span class="adm-cell-sub" x-text="(data.assets[wallet.assetKey]?.symbol || wallet.assetKey) + ' · ' + (data.assets[wallet.assetKey]?.network || '')"></span>
                    <code dir="ltr" style="display:block;margin-top:6px;word-break:break-all" x-text="wallet.address"></code>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0">
                    <button type="button" class="adm-btn ghost" :disabled="busy" @click="openEditor(wallet)">Edit</button>
                    <button type="button" class="adm-btn ghost" :disabled="busy" @click="toggle(wallet)" x-text="wallet.isActive ? 'Disable' : 'Enable'"></button>
                </div>
            </div>
        </template>
        <div class="adm-modal-overlay" x-show="editor" x-cloak @click.self="editor = null">
            <div class="adm-modal" role="dialog"><div class="adm-modal-head"><h3 x-text="editor?.id ? 'Edit receiving wallet' : 'Add receiving wallet'"></h3>
                <button class="adm-modal-close" @click="editor = null"><x-dash-icon name="close" /></button></div>
                <div class="adm-modal-body">
                    <template x-if="editorError"><div class="adm-banner error" x-text="editorError"></div></template>
                    <div class="adm-field"><label>Asset and network</label>
                        <select class="adm-select" :disabled="!!editor?.id" x-model="editor.assetKey">
                            <template x-for="[key, asset] in assetEntries()" :key="key"><option :value="key" x-text="asset.symbol + ' · ' + asset.network"></option></template>
                        </select>
                    </div>
                    <div class="adm-field"><label>Wallet label</label><input class="adm-input" x-model="editor.label" maxlength="80"></div>
                    <div class="adm-field"><label>Receiving address</label><input class="adm-input" dir="ltr" x-model="editor.address"></div>
                    <template x-if="editor?.assetKey === 'XRP'"><div class="adm-field"><label>XRP destination tag</label><input class="adm-input" dir="ltr" x-model="editor.destinationTag"></div></template>
                    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
                        <button type="button" class="adm-btn ghost" @click="editor = null">Cancel</button>
                        <button type="button" class="adm-btn primary" :disabled="busy || !editor?.address?.trim() || (editor?.label?.trim().length || 0) < 2" @click="save()">Save</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="adm-card adm-card-pad" style="margin-bottom:20px" x-show="!loading" x-cloak>
        <h2 style="font-size:18px;margin:0 0 6px">Crypto withdrawals &amp; swaps</h2>
            <p class="adm-note" style="margin-bottom:14px">Users withdraw crypto from the dashboard Withdraw modal (Crypto tab). Account swaps (crypto ↔ USD) are always available. External crypto-to-crypto swaps still require <code>SWAPS_ENABLED=true</code>, Changelly API credentials, and active swap routes below.</p>
        <label class="adm-swap-check" style="display:block;margin-bottom:10px">
            <input type="checkbox" :checked="map.crypto_withdrawals_enabled !== '0'" @change="map.crypto_withdrawals_enabled = $event.target.checked ? '1' : '0'; save('crypto_withdrawals_enabled')">
            Allow crypto withdrawals (USD or crypto balance → on-chain payout)
        </label>
        <p class="adm-cell-sub">Swaps server flag: set <code>SWAPS_ENABLED=true</code> in <code>.env</code> and configure Changelly + treasury wallets.</p>
    </div>

    <div x-data="admMailSettings()" x-init="init()" class="adm-card adm-card-pad" style="margin-bottom:20px">
        <div class="adm-wallet-heading" style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px">
            <div>
                <h2 style="font-size:18px;margin:0 0 6px">Email &amp; SMTP</h2>
                <p class="adm-note">Stored in the database. Account notifications and password recovery use these settings. Run <code>php artisan queue:work database --queue=mail</code> so notification emails send in the background.</p>
            </div>
            <span class="adm-cell-sub" x-text="mail.deliveryAvailable ? 'SMTP ready' : 'SMTP incomplete'"></span>
        </div>
        <template x-if="mailToast"><div class="adm-banner" role="status" x-text="mailToast"></div></template>
        <template x-if="mailError"><div class="adm-banner error" x-text="mailError"></div></template>
        <template x-if="mailLoading"><div class="adm-loading"><span class="adm-spinner"></span> Loading mail settings…</div></template>
        <template x-if="mail && !mailLoading">
            <label class="adm-swap-check" style="margin-bottom:14px"><input type="checkbox" x-model="mail.accountEmails"> Send account notification emails (in-app notifications always appear)</label>
            <div class="adm-field"><label>SMTP host</label><input class="adm-input" dir="ltr" x-model="mail.host" placeholder="smtp.example.com"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div class="adm-field"><label>Port</label><input class="adm-input" dir="ltr" type="number" min="1" max="65535" x-model.number="mail.port"></div>
                <div class="adm-field"><label>Encryption</label>
                    <select class="adm-select" x-model="mail.encryption">
                        <option value="tls">TLS (587)</option>
                        <option value="ssl">SSL (465)</option>
                        <option value="none">None</option>
                    </select>
                </div>
            </div>
            <div class="adm-field"><label>Username</label><input class="adm-input" dir="ltr" autocomplete="off" x-model="mail.username"></div>
            <div class="adm-field"><label>Password</label>
                <input class="adm-input" dir="ltr" type="password" autocomplete="new-password" x-model="mailPassword" :placeholder="mail.passwordConfigured ? 'Leave blank to keep current password' : 'SMTP password'">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div class="adm-field"><label>From address</label><input class="adm-input" dir="ltr" type="email" x-model="mail.fromAddress"></div>
                <div class="adm-field"><label>From name</label><input class="adm-input" x-model="mail.fromName"></div>
            </div>
            <div class="adm-field"><label>Send test to</label>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <input class="adm-input" style="flex:1;min-width:200px" dir="ltr" type="email" x-model="testEmail" placeholder="you@example.com">
                    <button type="button" class="adm-btn ghost" :disabled="mailBusy || !testEmail" @click="sendTest()">Send test</button>
                    <button type="button" class="adm-btn primary" :disabled="mailBusy || !mail.host || !mail.fromAddress" @click="saveMail()"><span x-text="mailBusy ? 'Saving…' : 'Save SMTP'"></span></button>
                </div>
            </div>
        </template>
    </div>

    <div x-data="admSwapConfig()" x-init="init()" class="adm-card adm-card-pad" style="margin-bottom:20px">
        <div class="adm-wallet-heading" style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px">
            <div><h2 style="font-size:18px;margin:0 0 6px">Crypto swaps</h2><p class="adm-note">Map supported exchange assets to treasury receiving wallets.</p></div>
            <a href="/admin/swaps" class="adm-btn ghost">Manage swaps</a>
        </div>
        <template x-if="toast"><div class="adm-banner" x-text="toast"></div></template>
        <template x-if="error && !editor"><div class="adm-banner error"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">Retry</button></div></template>
        <template x-if="loading"><div class="adm-loading"><span class="adm-spinner"></span> Loading swap configuration…</div></template>
        <template x-if="data">
            <p class="adm-notice" x-text="!data.credentialsConfigured ? 'Configure Changelly credentials on the server to connect the exchange provider.' : !data.providerAvailable ? 'The exchange provider is unavailable.' : !data.enabled ? 'Enable swaps on the server after configuring treasury routes.' : 'Exchange provider connected.'"></p>
            <template x-for="assetKey in assetKeys()" :key="assetKey">
                <div class="adm-receiving-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--dash-border)">
                    <div><strong x-text="data.assets[assetKey]?.symbol"></strong>
                        <span class="adm-cell-sub" x-text="data.assets[assetKey]?.network"></span>
                        <span class="adm-cell-sub" x-text="walletLabel(routeFor(assetKey)?.walletId)"></span>
                    </div>
                    <span x-text="routeFor(assetKey)?.isActive && routeFor(assetKey)?.walletId ? 'Enabled' : 'Disabled'"></span>
                    <button type="button" class="adm-btn ghost" @click="openRoute(assetKey)">Configure</button>
                </div>
            </template>
        </template>
        <div class="adm-modal-overlay" x-show="editor" x-cloak @click.self="editor = null">
            <div class="adm-modal" role="dialog"><div class="adm-modal-head"><h3>Configure swap asset</h3>
                <button class="adm-modal-close" @click="editor = null"><x-dash-icon name="close" /></button></div>
                <div class="adm-modal-body">
                    <template x-if="error"><div class="adm-banner error" x-text="error"></div></template>
                    <p x-show="editor"><strong x-text="(data?.assets[editor?.assetKey]?.symbol || '') + ' · ' + (data?.assets[editor?.assetKey]?.network || '')"></strong></p>
                    <div class="adm-field"><label>Provider asset</label>
                        <select class="adm-select" x-model="editor.providerTicker">
                            <option value="" disabled>Select</option>
                            <template x-for="row in (data?.currencies || []).filter(c => c.assetKey === editor?.assetKey)" :key="row.ticker">
                                <option :value="row.ticker" :disabled="!row.enabled" x-text="row.ticker"></option>
                            </template>
                        </select>
                    </div>
                    <div class="adm-field"><label>Receiving wallet</label>
                        <select class="adm-select" x-model="editor.walletId">
                            <option value="" disabled>Select</option>
                            <template x-for="w in (data?.wallets || []).filter(w => w.assetKey === editor?.assetKey)" :key="w.id">
                                <option :value="w.id" x-text="w.label + ' · ' + w.address"></option>
                            </template>
                        </select>
                    </div>
                    <label class="adm-swap-check"><input type="checkbox" x-model="editor.isActive"> Enable this swap asset</label>
                    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
                        <button type="button" class="adm-btn ghost" @click="editor = null">Cancel</button>
                        <button type="button" class="adm-btn primary" :disabled="busy || !editor?.walletId || !editor?.providerTicker" @click="save()">Save</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <template x-if="loading"><div class="adm-loading"><span class="adm-spinner" aria-hidden="true"></span> Loading settings…</div></template>

    <div class="adm-card adm-card-pad" x-show="!loading" x-cloak>
        <template x-for="(value, key) in map" :key="key">
            <template x-if="!['deposit_btc_address','deposit_eth_address','deposit_usdt_trc20','deposit_usdt_bep20'].includes(key) && !key.startsWith('mail_')">
                <div class="adm-field" style="margin-bottom:14px">
                    <label x-text="key"></label>
                    <div style="display:flex;gap:8px">
                        <input class="adm-input" style="flex:1" :value="value" @input="map[key] = $event.target.value">
                        <button class="adm-btn ghost" :disabled="saving === key" @click="save(key)"><span x-text="saving === key ? 'Saving…' : 'Save'"></span></button>
                    </div>
                </div>
            </template>
        </template>
        <template x-if="Object.keys(map).length === 0"><p class="adm-note">No settings defined yet.</p></template>
    </div>
</div>
@endsection
