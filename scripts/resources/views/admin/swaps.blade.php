@extends('layouts.admin')
@section('title', 'Crypto swaps | QFS')

@section('admin-content')
<div x-data="admArray({ endpoint: '/api/admin/swaps', pendingParam: 'pending=1' })">
    <div class="adm-page-head">
        <div><h1>Crypto swaps</h1><p>{{ $tx('Track exchange execution, treasury funding and settlement.') }}</p></div>
        <div class="adm-page-actions"><a href="/admin/settings" class="adm-btn ghost">Configure swaps</a></div>
    </div>
    <label class="adm-swap-check"><input type="checkbox" x-model="pending" @change="load()"> Pending swaps only</label>

    <template x-if="toast"><p class="adm-banner" role="status" x-text="toast"></p></template>
    <template x-if="error && !selected"><div class="adm-banner error"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">Retry</button></div></template>
    <template x-if="loading && !rows.length"><div class="adm-loading"><span class="adm-spinner" aria-hidden="true"></span> Loading…</div></template>
    <template x-if="!loading && rows.length === 0"><p class="adm-notice">No swaps to display.</p></template>

    <template x-for="row in rows" :key="row.id">
        <button class="adm-swap-row" @click="open(row)">
            <span><strong x-text="row.userEmail"></strong><small x-text="date(row.createdAt)"></small></span>
            <span><bdi x-text="row.quantity + ' ' + row.fromSymbol + ' → ' + ((row.receivedQuantity ?? row.quotedQuantity)) + ' ' + row.toSymbol"></bdi><small x-text="row.fromNetwork + ' → ' + row.toNetwork"></small></span>
            <span class="adm-pill" x-text="cap(row.status)"></span>
        </button>
    </template>

    <div class="adm-modal-overlay" x-show="selected" x-cloak @click.self="close()">
        <div class="adm-modal wide" role="dialog" aria-modal="true">
            <div class="adm-modal-head"><h3>Swap details</h3><button class="adm-modal-close" :disabled="busy" @click="close()"><x-dash-icon name="close" /></button></div>
            <div class="adm-modal-body"><fieldset class="adm-modal-fieldset" :disabled="busy">
                <template x-if="actionError"><div class="adm-banner error" x-text="actionError"></div></template>
                <p><strong dir="ltr" x-text="selected && (selected.quantity + ' ' + selected.fromSymbol + ' → ' + ((selected.receivedQuantity ?? selected.quotedQuantity)) + ' ' + selected.toSymbol)"></strong></p>
                <p x-text="selected && (cap(selected.status) + ' · ' + selected.userEmail)"></p>
                <dl class="adm-swap-details">
                    <div><dt>Reference</dt><dd><code x-text="selected && selected.reference"></code></dd></div>
                    <div><dt>Provider order</dt><dd><code x-text="selected && (selected.providerId || '—')"></code></dd></div>
                    <template x-if="selected && selected.payinAddress"><div><dt>Exchange receiving address</dt><dd><code x-text="selected.payinAddress"></code></dd></div></template>
                    <template x-if="selected && selected.payinHash"><div><dt>Funding transaction</dt><dd><code x-text="selected.payinHash"></code></dd></div></template>
                </dl>
                <template x-if="selected && selected.lastError"><p class="adm-notice" role="status" x-text="selected.lastError"></p></template>

                <template x-if="selected && !['COMPLETED','CANCELLED','REFUNDED'].includes(selected.status)">
                    <div>
                        <button class="adm-btn ghost" :disabled="busy" @click="run('/api/admin/swaps/' + selected.id, { action: 'REFRESH' }, 'Swap status updated.', 'POST')">Refresh provider status</button>
                        <template x-if="!selected.providerId">
                            <div style="margin-top:10px">
                                <div class="adm-field"><label>Recover provider order ID</label><input class="adm-input" x-model="form.providerId"></div>
                                <button class="adm-btn primary" :disabled="busy || !form.providerId" @click="run('/api/admin/swaps/' + selected.id, { action: 'RECOVER', providerId: form.providerId }, 'Order recovered.', 'POST')">Verify and recover order</button>
                            </div>
                        </template>
                        <template x-if="selected.status === 'AWAITING_FUNDING' && !(extra && extra.automaticFunding)">
                            <button class="adm-btn primary" style="margin-top:10px" :disabled="busy" @click="run('/api/admin/swaps/' + selected.id, { action: 'BEGIN_FUNDING' }, 'Funding started.', 'POST')">Begin treasury funding</button>
                        </template>
                        <template x-if="selected.fundingAttemptAt && !selected.payinHash">
                            <div style="margin-top:10px">
                                <div class="adm-field"><label>Funding transaction</label><input class="adm-input" dir="ltr" x-model="form.hash"></div>
                                <button class="adm-btn primary" :disabled="busy || !form.hash" @click="run('/api/admin/swaps/' + selected.id, { action: 'RECORD_FUNDING', txHash: form.hash }, 'Funding recorded.', 'POST')">Record funding transaction</button>
                            </div>
                        </template>
                    </div>
                </template>
            </fieldset></div>
        </div>
    </div>
</div>
@endsection
