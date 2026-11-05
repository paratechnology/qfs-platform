<div x-data="admData({ endpoint: '/api/admin/{{ $resource }}' })">
    <div class="adm-page-head"><div><h1>{{ $title }}</h1><p>{{ $subtitle }}</p></div></div>

    <template x-if="loading && !data"><div class="adm-loading"><span class="adm-spinner" aria-hidden="true"></span> {{ $tx('Loading…') }}</div></template>
    <template x-if="error"><div class="adm-banner error"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">{{ $tx('Retry') }}</button></div></template>
    <template x-if="data && data.length === 0"><div class="adm-empty"><b>{{ $tx('Nothing here yet') }}</b></div></template>

    <div class="adm-stats-grid" x-show="data && data.length" x-cloak>
        <template x-for="(item, i) in (data || [])" :key="i">
            <div class="adm-card adm-card-pad">
                <template x-for="(val, key) in item" :key="key">
                    <div style="display:flex;justify-content:space-between;gap:12px;font-size:12.5px;padding:4px 0;border-bottom:1px solid var(--dash-border)">
                        <span style="color:var(--dash-muted)" x-text="key"></span>
                        <b style="text-align:right;overflow-wrap:anywhere;max-width:60%" x-text="val && typeof val === 'object' ? JSON.stringify(val) : String(val ?? '—')"></b>
                    </div>
                </template>
            </div>
        </template>
    </div>

    <p class="adm-note" style="margin-top:14px">Listing is live from the API. The in-page create/edit editor for {{ strtolower($title) }} is the next refinement.</p>
</div>
