@extends('layouts.admin')
@section('title', 'Principal Releases | QFS')

@section('admin-content')
<div x-data="admArray({ endpoint: '/api/admin/investments' })">
    <div class="adm-page-head"><div><h1>{{ $tx('Principal releases') }}</h1><p>{{ $tx('Completed investment terms awaiting return of original principal.') }}</p></div></div>

    <template x-if="toast"><p class="adm-banner" role="status" x-text="toast"></p></template>
    <template x-if="error"><div class="adm-banner error" role="alert"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">{{ $tx('Retry') }}</button></div></template>
    <template x-if="loading && !rows.length"><div class="adm-loading" role="status"><span class="adm-spinner" aria-hidden="true"></span> {{ $tx('Loading matured investments…') }}</div></template>
    <template x-if="!loading && !error && rows.length === 0"><div class="adm-empty"><b>{{ $tx('Nothing here yet') }}</b></div></template>

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead><tr><th>{{ $tx('Account') }}</th><th>{{ $tx('Plan') }}</th><th>{{ $tx('Principal') }}</th><th>{{ $tx('Profit paid') }}</th><th>{{ $tx('Term completed') }}</th><th></th></tr></thead>
            <tbody>
                <template x-for="item in rows" :key="item.id">
                    <tr>
                        <td><div><strong x-text="item.userName"></strong><small style="display:block;color:var(--dash-muted)" x-text="item.userEmail"></small></div></td>
                        <td x-text="item.planName"></td>
                        <td x-text="money(item.amountCents)"></td>
                        <td x-text="money(item.paidOutCents)"></td>
                        <td x-text="item.maturedAt ? date(item.maturedAt) : 'Not recorded'"></td>
                        <td><button class="adm-btn ghost sm" @click="open(item)">{{ $tx('Review release') }}</button></td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>

    <div class="adm-modal-overlay" x-show="selected" x-cloak @click.self="close()">
        <div class="adm-modal" role="dialog" aria-modal="true">
            <div class="adm-modal-head"><h3>{{ $tx('Release investment principal') }}</h3><button class="adm-modal-close" :disabled="busy" @click="close()"><x-dash-icon name="close" /></button></div>
            <div class="adm-modal-body"><fieldset class="adm-modal-fieldset" :disabled="busy">
                <dl class="adm-kyc-details">
                    <div><dt>{{ $tx('Account') }}</dt><dd x-text="selected && (selected.userName + ' · ' + selected.userEmail)"></dd></div>
                    <div><dt>{{ $tx('Plan') }}</dt><dd x-text="selected && selected.planName"></dd></div>
                    <div><dt>{{ $tx('Principal') }}</dt><dd x-text="selected && money(selected.amountCents)"></dd></div>
                    <div><dt>{{ $tx('Profit paid') }}</dt><dd x-text="selected && money(selected.paidOutCents)"></dd></div>
                </dl>
                <p class="adm-note">{{ $tx('This restores the original principal to available balance. Total balance remains unchanged because it already includes invested capital. Profit was settled separately.') }}</p>
                <template x-if="actionError"><div class="adm-banner error" x-text="actionError"></div></template>
                <div class="adm-modal-actions">
                    <button class="adm-btn ghost" :disabled="busy" @click="close()">{{ $tx('Cancel') }}</button>
                    <button class="adm-btn primary" :disabled="busy" @click="run('/api/admin/investments/' + selected.id, { action: 'RELEASE_PRINCIPAL' }, 'Principal released.')"><span x-text="busy ? 'Releasing principal…' : ('Release ' + (selected ? money(selected.amountCents) : ''))"></span></button>
                </div>
            </fieldset></div>
        </div>
    </div>
</div>
@endsection
