@extends('layouts.admin')
@section('title', 'Markets | QFS')

@section('admin-content')
<div x-data="admContent({ resource: 'markets', defaults: { type: 'CRYPTO', direction: 'up', color: '#2b2b3a', sort: 0, isActive: true } })">
    <div class="adm-page-head"><div><h1>Markets</h1><p>Assets shown on the dashboard markets table.</p></div><div class="adm-page-actions"><button class="adm-btn primary" @click="openNew()">New asset</button></div></div>

    <template x-if="toast"><div class="adm-banner" role="status" x-text="toast"></div></template>
    <template x-if="error"><div class="adm-banner error"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">Retry</button></div></template>
    <template x-if="loading && !rows.length"><div class="adm-loading"><span class="adm-spinner" aria-hidden="true"></span> Loading…</div></template>
    <template x-if="!loading && rows.length === 0"><div class="adm-empty"><b>No assets yet</b></div></template>

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead><tr><th>Symbol</th><th>Name</th><th>Type</th><th>Price</th><th>Change</th><th>Active</th><th class="num"></th></tr></thead>
            <tbody>
                <template x-for="r in rows" :key="r.id">
                    <tr>
                        <td x-text="r.symbol"></td><td x-text="r.name"></td><td x-text="r.type"></td>
                        <td class="num" x-text="r.price"></td><td x-text="r.change"></td><td x-text="r.isActive ? 'Yes' : 'No'"></td>
                        <td class="num"><div class="adm-actions-cell"><button class="adm-btn ghost sm" @click="openEdit(r)">Edit</button><button class="adm-btn danger sm" :disabled="busy" @click="remove(r.id)">Delete</button></div></td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>

    <div class="adm-modal-overlay" x-show="editing" x-cloak @click.self="close()">
        <div class="adm-modal" role="dialog" aria-modal="true">
            <div class="adm-modal-head"><h3 x-text="editing === 'new' ? 'New asset' : 'Edit asset'"></h3><button class="adm-modal-close" :disabled="busy" @click="close()"><x-dash-icon name="close" /></button></div>
            <div class="adm-modal-body"><fieldset class="adm-modal-fieldset" :disabled="busy">
                <div class="adm-field"><label>Symbol</label><input class="adm-input" x-model="form.symbol"></div>
                <div class="adm-field"><label>Name</label><input class="adm-input" x-model="form.name"></div>
                <div class="adm-field"><label>Full name</label><input class="adm-input" x-model="form.full"></div>
                <div class="adm-field"><label>Type</label><select class="adm-select" x-model="form.type"><option>METAL</option><option>STOCK</option><option>CRYPTO</option></select></div>
                <div class="adm-field"><label>Price</label><input class="adm-input" x-model="form.price"></div>
                <div class="adm-field"><label>{{ $tx('Change (24h)') }}</label><input class="adm-input" x-model="form.change"></div>
                <div class="adm-field"><label>Direction</label><select class="adm-select" x-model="form.direction"><option value="up">up</option><option value="down">down</option><option value="flat">flat</option></select></div>
                <div class="adm-field"><label>Color</label><input class="adm-input" x-model="form.color"></div>
                <label class="adm-swap-check"><input type="checkbox" x-model="form.isActive"> Active</label>
                <template x-if="formError"><div class="adm-banner error" x-text="formError"></div></template>
                <div class="adm-row-end"><button class="adm-btn ghost" @click="close()" :disabled="busy">Cancel</button><button class="adm-btn primary" @click="save()" :disabled="busy"><span x-text="busy ? 'Saving…' : 'Save'"></span></button></div>
            </fieldset></div>
        </div>
    </div>
</div>
@endsection
