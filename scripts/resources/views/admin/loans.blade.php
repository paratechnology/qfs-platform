@extends('layouts.admin')
@section('title', 'Loans | QFS')

@section('admin-content')
<div x-data="admList({ endpoint: '/api/admin/loans', filters: { status: 'ALL' } })">
    <div class="adm-page-head"><div><h1>Loans</h1><p>Applications from users and their current review status.</p></div></div>

    <div class="adm-inline-form">
        <select class="adm-select" x-model="filters.status" @change="search()">
            <option value="ALL">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
        </select>
    </div>

    @include('admin.partials.list-states', ['loadingLabel' => 'Loading loans…'])

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead><tr><th>User</th><th>Loan</th><th>Amount</th><th>Status</th><th>Created</th><th class="num"></th></tr></thead>
            <tbody>
                <template x-for="l in rows" :key="l.id">
                    <tr>
                        <td><div style="min-width:0"><b x-text="l.userName"></b><span class="adm-cell-sub" x-text="l.userEmail"></span></div></td>
                        <td><div><b x-text="l.type"></b><span class="adm-cell-sub" x-text="(l.currency || '') + (l.period ? ' · ' + l.period + ' months' : '')"></span></div></td>
                        <td><span class="num" x-text="l.amount"></span></td>
                        <td><span class="adm-pill" :class="pill(l.status)" x-text="cap(l.status)"></span></td>
                        <td style="white-space:nowrap" x-text="date(l.createdAt)"></td>
                        <td class="num">
                            <template x-if="l.status === 'PENDING'">
                                <div class="adm-actions-cell">
                                    <button class="adm-btn good sm" @click="openDecision(l, 'APPROVE')">Approve</button>
                                    <button class="adm-btn danger sm" @click="openDecision(l, 'REJECT')">Reject</button>
                                </div>
                            </template>
                            <template x-if="l.status !== 'PENDING'"><span class="adm-cell-sub" x-text="cap(l.status)"></span></template>
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
                <h3 x-text="(decision && decision.action === 'APPROVE' ? 'Approve' : 'Reject') + ' loan'"></h3>
                <button class="adm-modal-close" aria-label="Close" :disabled="decisionBusy" @click="closeDecision()"><x-dash-icon name="close" /></button>
            </div>
            <div class="adm-modal-body"><fieldset class="adm-modal-fieldset" :disabled="decisionBusy">
                <p class="adm-confirm-text"><b style="color:var(--dash-text)" x-text="decision && decision.row.userName"></b> · <span x-text="decision && decision.row.amount"></span></p>
                <div class="adm-field"><label>{{ $tx('Admin note (optional, sent to the user)') }}</label><textarea class="adm-textarea" x-model="note"></textarea></div>
                <template x-if="decisionError"><div class="adm-banner error" x-text="decisionError"></div></template>
                <div class="adm-row-end">
                    <button class="adm-btn ghost" @click="closeDecision()" :disabled="decisionBusy">Cancel</button>
                    <button class="adm-btn" :class="decision && decision.action === 'APPROVE' ? 'good' : 'danger'" :disabled="decisionBusy" @click="confirmDecision('/api/admin/loans/' + decision.row.id)"><span x-text="decisionBusy ? 'Working…' : (decision && decision.action === 'APPROVE' ? 'Approve' : 'Reject')"></span></button>
                </div>
            </fieldset></div>
        </div>
    </div>
</div>
@endsection
