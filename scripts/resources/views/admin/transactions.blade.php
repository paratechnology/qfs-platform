@extends('layouts.admin')
@section('title', 'Transactions | QFS')

@section('admin-content')
<div x-data="admList({ endpoint: '/api/admin/transactions', filters: { type: 'ALL', status: 'ALL' } })">
    <div class="adm-page-head"><div><h1>Transactions</h1><p>{{ $tx('Every ledger movement across all accounts: deposits, withdrawals, investments, earnings and bonuses.') }}</p></div></div>

    <div class="adm-inline-form">
        <select class="adm-select" x-model="filters.type" @change="search()">
            <option value="ALL">All types</option>
            <option value="DEPOSIT">Deposits</option>
            <option value="WITHDRAWAL">Withdrawals</option>
            <option value="INVESTMENT">Investments</option>
            <option value="EARNING">Earnings</option>
            <option value="REFERRAL_BONUS">Referral bonuses</option>
            <option value="LOAN">Loans</option>
            <option value="ADJUSTMENT">Adjustments</option>
            <option value="PRINCIPAL_RETURN">Principal returns</option>
            <option value="SWAP">Crypto swaps</option>
        </select>
        <select class="adm-select" x-model="filters.status" @change="search()">
            <option value="ALL">All statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="PENDING">Pending</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="FAILED">Failed</option>
        </select>
    </div>

    @include('admin.partials.list-states', ['loadingLabel' => 'Loading transactions…'])

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead><tr><th>User</th><th>Type</th><th>Amount</th><th>Reference</th><th>Method</th><th>Status</th><th>Date</th></tr></thead>
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
