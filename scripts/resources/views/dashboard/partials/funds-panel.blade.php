<section class="fund-panel" aria-labelledby="funds-heading" x-data="cryptoFundsPanel()" x-init="init()" @dash-funds-refresh.window="refresh()">
    <div class="fund-heading">
        <div>
            <span class="dash-page-eyebrow" id="funds-heading">Available balance</span>
            <div class="fund-total" data-available-balance>
                <template x-if="loading && !data"><span class="dash-skeleton"></span></template>
                <template x-if="data"><span x-text="data.availableUsd ?? '—'"></span></template>
            </div>
            <p>{{ $tx('USD account and estimated crypto value. Reserved funds and invested principal are excluded.') }}</p>
            <template x-if="data?.totalUsd">
                <p class="fund-portfolio-total">Portfolio balance: <bdi x-text="data.totalUsd"></bdi></p>
            </template>
        </div>
        <div class="fund-actions">
            <button type="button" class="dash-btn primary" @click="$dispatch('dash-open-modal', 'deposit')">Deposit</button>
            <button type="button" class="dash-btn ghost" @click="$dispatch('dash-open-modal', 'invest')">{{ $tx('Invest') }}</button>
            <button type="button" class="dash-btn ghost" @click="$dispatch('dash-open-modal', 'withdraw')">Withdraw</button>
            <button type="button" class="dash-btn ghost" @click="$dispatch('dash-open-modal', 'swap')">Swap</button>
        </div>
    </div>
    <template x-if="error">
        <div class="dash-load-error"><p x-text="error"></p><button type="button" class="dash-btn ghost" @click="refresh()">Retry</button></div>
    </template>
    <template x-if="data && !data.valuationComplete">
        <p class="dash-input-note">Some crypto prices are unavailable. Your quantities are unchanged; the combined USD estimate is temporarily unavailable.</p>
    </template>
    <template x-if="data">
        <div class="fund-assets">
            <div class="fund-asset-row">
                <span class="fund-asset-symbol">$</span>
                <div class="fund-asset-name"><strong>USD account</strong><span>Available to invest or withdraw</span></div>
                <div class="fund-asset-value"><strong x-text="data.usd.available"></strong><span>Available</span></div>
            </div>
            <template x-for="asset in visibleHoldings()" :key="asset.assetKey">
                <div class="fund-asset-row" :data-asset-key="asset.assetKey">
                    <span class="fund-asset-symbol" aria-hidden="true" x-text="symbolGlyph(asset.symbol)"></span>
                    <div class="fund-asset-name"><strong x-text="asset.symbol"></strong><span x-text="asset.network"></span></div>
                    <div class="fund-asset-value">
                        <strong><bdi x-text="asset.available + ' ' + asset.symbol"></bdi></strong>
                        <span x-text="asset.availableUsd == null ? 'Price unavailable' : asset.availableUsd"></span>
                        <span x-show="asset.reserved !== '0'" x-text="'Reserved: ' + asset.reserved + ' ' + asset.symbol"></span>
                    </div>
                </div>
            </template>
            <p class="dash-input-note">Crypto values change until invested. Investments and their returns are fixed in USD.</p>
        </div>
        <template x-if="data.requests?.length">
            <details class="fund-activity">
                <summary>Recent funding activity</summary>
                <template x-for="item in data.requests.slice(0, 8)" :key="item.type + item.id">
                    <div class="fund-activity-row">
                        <div><strong x-text="item.type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'"></strong><span x-text="item.network"></span></div>
                        <div><bdi x-text="item.quantity + ' ' + item.symbol"></bdi>
                            <span class="dash-tx-status" :data-status="item.status.toLowerCase()" x-text="item.status"></span>
                            <small x-text="item.reference"></small>
                        </div>
                    </div>
                </template>
            </details>
        </template>
    </template>
</section>
