@extends('layouts.admin')
@section('title', 'Identity Verification | QFS')

@section('admin-content')
<div x-data="admKyc()">
    <div class="adm-page-head"><div><h1>{{ $tx('Identity verification') }}</h1><p>{{ $tx('Private document review. Approvals update the account’s verification status.') }}</p></div></div>

    <form class="adm-toolbar" @submit.prevent="search()">
        <select class="adm-input" x-model="status" @change="search()">
            <option value="PENDING">{{ $tx('Pending review') }}</option>
            <option value="NEEDS_CHANGES">{{ $tx('Changes requested') }}</option>
            <option value="APPROVED">{{ $tx('Approved') }}</option>
            <option value="ALL">{{ $tx('All submissions') }}</option>
        </select>
        <input class="adm-input" placeholder="{{ $tx('Search name or email') }}" x-model="query" maxlength="200">
        <button class="adm-btn ghost" type="submit">{{ $tx('Search') }}</button>
    </form>

    <template x-if="error"><div class="adm-banner error"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">{{ $tx('Retry') }}</button></div></template>
    <template x-if="loading && !rows.length"><div class="adm-loading"><span class="adm-spinner" aria-hidden="true"></span> {{ $tx('Loading submissions…') }}</div></template>
    <template x-if="!loading && !error && rows.length === 0"><div class="adm-empty"><b>{{ $tx('Nothing here yet') }}</b></div></template>

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead><tr><th>{{ $tx('Account') }}</th><th>{{ $tx('Status') }}</th><th>{{ $tx('Submitted') }}</th><th>{{ $tx('Actions') }}</th></tr></thead>
            <tbody>
                <template x-for="item in rows" :key="item.id">
                    <tr>
                        <td><div><strong x-text="item.userName"></strong><small style="display:block;color:var(--dash-muted)" x-text="item.email"></small></div></td>
                        <td><span class="adm-pill" :class="(item.status||'').toLowerCase()" x-text="cap(item.status)"></span></td>
                        <td x-text="date(item.submittedAt)"></td>
                        <td><button class="adm-btn ghost sm" @click="open(item)" x-text="item.status === 'PENDING' ? 'Review submission' : 'View review'"></button></td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>

    @include('admin.partials.pagination')

    {{-- Review modal --}}
    <div class="adm-modal-overlay" x-show="selected" x-cloak @click.self="close()">
        <div class="adm-modal wide" role="dialog" aria-modal="true">
            <div class="adm-modal-head"><h3 x-text="'Verification — ' + (selected ? selected.userName : '')"></h3><button class="adm-modal-close" :disabled="busy" @click="close()"><x-dash-icon name="close" /></button></div>
            <div class="adm-modal-body"><fieldset class="adm-modal-fieldset" :disabled="busy">
                <template x-if="reviewLoading"><div class="adm-loading"><span class="adm-spinner" aria-hidden="true"></span> {{ $tx('Loading private documents…') }}</div></template>
                <template x-if="reviewError"><div class="adm-banner error"><span x-text="reviewError"></span></div></template>
                <template x-if="message"><div class="adm-banner" role="status" x-text="message"></div></template>

                <template x-if="record">
                    <div>
                        <span class="adm-pill" :class="(record.status||'').toLowerCase()" x-text="cap(record.status)"></span>
                        <dl class="adm-kyc-details">
                            <div><dt>{{ $tx('Legal name') }}</dt><dd x-text="record.details.legalName"></dd></div>
                            <div><dt>{{ $tx('Date of birth') }}</dt><dd x-text="record.details.dateOfBirth"></dd></div>
                            <div><dt>{{ $tx('Country of residence') }}</dt><dd x-text="record.details.country"></dd></div>
                            <div><dt>{{ $tx('Residential address') }}</dt><dd x-text="record.details.address"></dd></div>
                            <div><dt>{{ $tx('Document type') }}</dt><dd x-text="(record.details.documentType || '').replace(/_/g, ' ')"></dd></div>
                            <div><dt>{{ $tx('Submitted') }}</dt><dd x-text="record.submittedAt ? date(record.submittedAt) : '—'"></dd></div>
                        </dl>
                        @include('partials.kyc-history', ['historyEndpoint' => "'/api/admin/kyc/' + record.id + '/history'", 'historyAdmin' => true])
                        <h3 style="font-size:14px">{{ $tx('Documents') }}</h3>
                        <ul class="adm-kyc-files">
                            <template x-for="file in record.files" :key="file.id">
                                <li><a class="adm-btn ghost" :href="file.url" target="_blank" rel="noreferrer" x-text="'Download ' + fileLabel(file.kind)"></a><small x-text="Math.ceil(file.size / 1024) + ' KB'"></small></li>
                            </template>
                        </ul>
                        <template x-if="record.reviewNote"><p class="adm-banner" x-text="record.reviewNote"></p></template>

                        <template x-if="record.status === 'PENDING'">
                            <div>
                                <div class="adm-field"><label>{{ $tx('Review note (required when requesting changes)') }}</label><textarea class="adm-textarea" rows="3" maxlength="1000" x-model="note"></textarea></div>
                                <label class="adm-check" style="display:flex;gap:10px;font-size:13px;line-height:1.7;margin:20px 0"><input type="checkbox" x-model="checked"> {{ $tx('I have reviewed the identity document, face photo, and submitted details.') }}</label>
                                <div class="adm-modal-actions">
                                    <button class="adm-btn ghost" :disabled="note.trim().length < 3 || busy" @click="decide('REQUEST_CHANGES')">{{ $tx('Request changes') }}</button>
                                    <button class="adm-btn primary" :disabled="!checked || busy" @click="decide('APPROVE')"><span x-text="busy ? 'Saving decision…' : 'Approve identity'"></span></button>
                                </div>
                            </div>
                        </template>
                        <template x-if="record.status !== 'PENDING'">
                            <p class="adm-banner" x-text="record.status === 'APPROVED' ? 'Approved. The account is verified.' : 'Changes requested. The user can update and resubmit their documents.'"></p>
                        </template>
                    </div>
                </template>
            </fieldset></div>
        </div>
    </div>
</div>
@endsection
