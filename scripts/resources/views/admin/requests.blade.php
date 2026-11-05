@extends('layouts.admin')
@section('title', 'Requests | QFS')

@section('admin-content')
<div x-data="admList({ endpoint: '/api/admin/requests', filters: { type: 'DEPOSIT', status: 'ALL' } })">
    <div class="adm-page-head"><div>
        <h1 x-text="filters.type === 'DEPOSIT' ? 'Deposit Requests' : 'Withdrawal Requests'"></h1>
        <p>{{ $tx('Manually review each request. Approving creates the transaction and updates the ledger atomically; withdrawals already reserve funds at submission.') }}</p>
    </div></div>

    <div class="adm-inline-form">
        <div class="adm-seg">
            <button :class="{ active: filters.type === 'DEPOSIT' }" @click="filters.type = 'DEPOSIT'; search()">{{ $tx('Deposits') }}</button>
            <button :class="{ active: filters.type === 'WITHDRAWAL' }" @click="filters.type = 'WITHDRAWAL'; search()">{{ $tx('Withdrawals') }}</button>
        </div>
        <select class="adm-select" x-model="filters.status" @change="search()">
            <option value="ALL">{{ $tx('All statuses') }}</option>
            <option value="PENDING">{{ $tx('Pending') }}</option>
            <option value="APPROVED">{{ $tx('Approved') }}</option>
            <option value="REJECTED">{{ $tx('Rejected') }}</option>
        </select>
    </div>

    @include('admin.partials.list-states', ['loadingLabel' => 'Loading requests…'])

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead><tr><th>{{ $tx('User') }}</th><th>{{ $tx('Amount') }}</th><th>{{ $tx('Method') }}</th><th>{{ $tx('Reference') }}</th><th>{{ $tx('Status') }}</th><th>{{ $tx('Created') }}</th><th class="num"></th></tr></thead>
            <tbody>
                <template x-for="r in rows" :key="r.id">
                    <tr>
                        <td><div style="min-width:0"><b x-text="r.userName"></b><span class="adm-cell-sub" x-text="r.userEmail"></span></div></td>
                        <td><span class="num" x-text="r.assetKey ? (r.quantity + ' ' + r.symbol) : money(r.amountCents)"></span></td>
                        <td x-text="r.method"></td>
                        <td><span style="font-family:ui-monospace,monospace;font-size:12px" x-text="r.reference"></span></td>
                        <td><span class="adm-pill" :class="pill(r.status)" x-text="cap(r.status)"></span></td>
                        <td style="white-space:nowrap" x-text="date(r.createdAt)"></td>
                        <td class="num">
                            <template x-if="r.status === 'PENDING'">
                                <div class="adm-actions-cell">
                                    <button class="adm-btn good sm" @click="openDecision(r, 'APPROVE')">{{ $tx('Approve') }}</button>
                                    <button class="adm-btn danger sm" @click="openDecision(r, 'REJECT')">{{ $tx('Reject') }}</button>
                                </div>
                            </template>
                            <template x-if="r.status !== 'PENDING'"><span class="adm-cell-sub">{{ $tx('Reviewed') }}</span></template>
                        </td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>

    @include('admin.partials.pagination')

    {{-- Approve / reject --}}
    <div class="adm-modal-overlay" x-show="decision" x-cloak @click.self="closeDecision()">
        <div class="adm-modal" role="dialog" aria-modal="true">
            <div class="adm-modal-head">
                <h3 x-text="(decision && decision.action === 'APPROVE' ? 'Approve ' : 'Reject ') + (filters.type === 'DEPOSIT' ? 'deposit' : 'withdrawal')"></h3>
                <button class="adm-modal-close" aria-label="{{ $tx('Close') }}" :disabled="decisionBusy" @click="closeDecision()"><x-dash-icon name="close" /></button>
            </div>
            <div class="adm-modal-body"><fieldset class="adm-modal-fieldset" :disabled="decisionBusy">
                <p class="adm-confirm-text">
                    <b style="color:var(--dash-text)" x-text="decision && decision.row.userName"></b> ·
                    <span x-text="decision && (decision.row.assetKey ? (decision.row.quantity + ' ' + decision.row.symbol) : money(decision.row.amountCents))"></span>
                    {{ $tx('via') }} <span x-text="decision && decision.row.method"></span>
                </p>
                <div class="adm-field"><label>{{ $tx('Admin note (optional, sent to the user)') }}</label><textarea class="adm-textarea" x-model="note"></textarea></div>
                <template x-if="decision && decision.row.assetKey">
                    <div class="adm-notice">
                        <b x-text="decision.row.network"></b>
                        <code style="display:block;overflow-wrap:anywhere" x-text="decision.row.receivingAddress"></code>
                        <template x-if="decision.row.explorerUrl"><a :href="decision.row.explorerUrl" target="_blank" rel="noreferrer noopener">{{ $tx('View blockchain transaction ↗') }}</a></template>
                    </div>
                </template>
                <template x-if="decision && decision.row.assetKey && decision.action === 'APPROVE'">
                    <div class="adm-field"><label>{{ $tx('Transaction hash (optional)') }}</label><input class="adm-input" dir="ltr" x-model="txHash" maxlength="100" autocomplete="off" spellcheck="false"></div>
                </template>
                <template x-if="decisionError"><div class="adm-banner error" x-text="decisionError"></div></template>
                <div class="adm-row-end">
                    <button class="adm-btn ghost" @click="closeDecision()" :disabled="decisionBusy">{{ $tx('Cancel') }}</button>
                    <button class="adm-btn" :class="decision && decision.action === 'APPROVE' ? 'good' : 'danger'" :disabled="decisionBusy"
                        @click="confirmDecision('/api/admin/requests/' + decision.row.id + '?type=' + filters.type, (decision.row.assetKey && decision.action === 'APPROVE' && txHash.trim()) ? { txHash: txHash.trim() } : {})">
                        <span x-text="decisionBusy ? 'Working…' : (decision && decision.action === 'APPROVE' ? 'Approve' : 'Reject')"></span>
                    </button>
                </div>
            </fieldset></div>
        </div>
    </div>
</div>
@endsection
