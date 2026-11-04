<div class="dash-card dash-card-pad" x-data="txList('/api/transactions')">
    @if(request('id'))
        <a class="dash-btn ghost" href="/user/user/dashboard/transactions">{{ $tx('View all transactions') }}</a>
    @endif
    <template x-if="loading"><p class="dash-input-note" role="status">{{ $tx('Loading transactions…') }}</p></template>
    <template x-if="error"><p class="dash-form-error" role="alert"><x-dash-icon name="info" :size="18" /> <span x-text="error"></span></p></template>
    <template x-if="!loading && !error && items.length === 0"><div class="dash-notice"><x-dash-icon name="info" /> No transactions yet.</div></template>
    <div class="dash-tx-list">
        <template x-for="t in items" :key="t.id">
            <div class="dash-tx-item">
                <span class="dash-tx-ico" :class="t.kind" x-html="iconSvg(t.kind)"></span>
                <div class="dash-tx-meta"><b x-text="t.title"></b><span x-text="t.meta"></span><span x-text="t.date"></span></div>
                <div class="dash-tx-amount"><b class="num" :class="t.cls" x-text="t.amount"></b><span class="dash-tx-status" :data-status="t.status.toLowerCase()" x-text="t.status"></span></div>
            </div>
        </template>
    </div>
    <template x-if="cursor">
        <button class="dash-btn ghost block" @click="more()" :disabled="loadingMore"><span x-text="loadingMore ? 'Loading…' : 'Load more'"></span></button>
    </template>
</div>
