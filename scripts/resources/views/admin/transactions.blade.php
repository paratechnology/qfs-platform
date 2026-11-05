@extends('layouts.admin')
@section('title', 'Transactions | QFS')

@section('admin-content')
<div x-data="admList({ endpoint: '/api/admin/transactions', filters: { type: 'ALL', status: 'ALL' } })">
    <div class="adm-page-head"><div><h1>{{ $tx('Transactions') }}</h1><p>{{ $tx('Every ledger movement across all accounts: deposits, withdrawals, investments, earnings and bonuses.') }}</p></div></div>

    <div class="adm-inline-form">
        <select class="adm-select" x-model="filters.type" @change="search()">
            <option value="ALL">{{ $tx('All types') }}</option>
            <option value="DEPOSIT">{{ $tx('Deposits') }}</option>
            <option value="WITHDRAWAL">{{ $tx('Withdrawals') }}</option>
            <option value="INVESTMENT">{{ $tx('Investments') }}</option>
            <option value="EARNING">{{ $tx('Earnings') }}</option>
            <option value="REFERRAL_BONUS">{{ $tx('Referral bonuses') }}</option>
            <option value="LOAN">{{ $tx('Loans') }}</option>
            <option value="ADJUSTMENT">{{ $tx('Adjustments') }}</option>
            <option value="PRINCIPAL_RETURN">{{ $tx('Principal returns') }}</option>
            <option value="SWAP">{{ $tx('Crypto swaps') }}</option>
        </select>
        <select class="adm-select" x-model="filters.status" @change="search()">
            <option value="ALL">{{ $tx('All statuses') }}</option>
            <option value="COMPLETED">{{ $tx('Completed') }}</option>
            <option value="PENDING">{{ $tx('Pending') }}</option>
            <option value="CANCELLED">{{ $tx('Cancelled') }}</option>
            <option value="FAILED">{{ $tx('Failed') }}</option>
        </select>
    </div>

    @include('admin.partials.list-states', ['loadingLabel' => 'Loading transactions…'])

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead><tr><th>{{ $tx('User') }}</th><th>{{ $tx('Type') }}</th><th>{{ $tx('Amount') }}</th><th>{{ $tx('Reference') }}</th><th>{{ $tx('Method') }}</th><th>{{ $tx('Status') }}</th><th>{{ $tx('Date') }}</th></tr></thead>
            <tbody>
                <template x-for="t in rows" :key="t.id">
                    <tr>
                        <td><div style="min-width:0"><b x-text="t.userName"></b><span class="adm-cell-sub" x-text="t.userEmail"></span></div></td>
                        <td><span class="adm-pill" :class="pill(t.type)" x-text="cap(t.type)"></span></td>
                        <td><span class="num" x-text="t.amount"></span></td>
                        <td><span style="font-family:ui-monospace,monospace;font-size:12px" x-text="t.reference"></span></td>
                        <td x-text="t.method || '—'"></td>
                        <td><span class="adm-pill" :class="pill(t.status)" x-text="cap(t.status)"></span></td>
                        <td style="white-space:nowrap" x-text="date(t.createdAt)"></td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>

    @include('admin.partials.pagination')
</div>
@endsection
