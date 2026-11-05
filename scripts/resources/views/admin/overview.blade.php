@extends('layouts.admin')

@section('title', 'Admin Overview | QFS')

@php
    $s = $stats;
    $m = fn ($cents) => '$' . number_format(((int) ($cents ?? 0)) / 100, 2);
    $pd = $s['pendingDeposits'] ?? ['count' => 0, 'sumCents' => 0];
    $pw = $s['pendingWithdrawals'] ?? ['count' => 0, 'sumCents' => 0];
@endphp

@section('admin-content')
<div class="adm-hero">
    <div>
        <h2>{{ $tx('Operations Overview') }}</h2>
        <p>{{ $tx('Monitor account balances, pending reviews and platform activity at a glance. Approve deposits and withdrawals from the Requests section — every action is recorded in the audit log.') }}</p>
    </div>
    <div class="adm-hero-actions">
        <a class="adm-btn primary" href="/admin/requests">{{ $tx('Review Requests') }}</a>
        <a class="adm-btn ghost" href="/admin/transactions">{{ $tx('All Transactions') }}</a>
    </div>
</div>

<div class="adm-stats-grid">
    @include('admin.partials.stat', ['label' => 'Total Users', 'value' => $s['totalUsers'] ?? 0, 'sub' => '+' . ($s['newUsers30d'] ?? 0) . ' new in 30d', 'ico' => 'dashboard'])
    @include('admin.partials.stat', ['label' => 'Active Users', 'value' => $s['activeUsers'] ?? 0, 'sub' => ($s['suspendedUsers'] ?? 0) . ' suspended', 'ico' => 'wallet'])
    @include('admin.partials.stat', ['label' => 'USD account balances', 'value' => $s['totalBalance'] ?? '$0.00', 'sub' => 'All user accounts', 'ico' => 'wallet'])
    @include('admin.partials.stat', ['label' => 'USD deposits', 'value' => $s['totalDeposits'] ?? '$0.00', 'sub' => 'Lifetime, credited', 'ico' => 'arrow-down'])
    @include('admin.partials.stat', ['label' => 'Total Withdrawals', 'value' => $s['totalWithdrawals'] ?? '$0.00', 'sub' => 'Lifetime, paid out', 'ico' => 'arrow-up'])
    @include('admin.partials.stat', ['label' => 'Pending Deposits', 'value' => $pd['count'], 'sub' => 'Pending review', 'ico' => 'arrow-down'])
    @include('admin.partials.stat', ['label' => 'Pending Withdrawals', 'value' => $pw['count'], 'sub' => $m($pw['sumCents']) . ' awaiting review', 'ico' => 'arrow-up'])
    @include('admin.partials.stat', ['label' => 'Pending Loans', 'value' => $s['pendingLoans'] ?? 0, 'sub' => 'Loan applications to review', 'ico' => 'wallet'])
    @include('admin.partials.stat', ['label' => 'Active Investments', 'value' => $s['activeInvestments'] ?? 0, 'sub' => $m($s['activeInvestmentsCents'] ?? 0) . ' committed', 'ico' => 'trending-up'])
    @include('admin.partials.stat', ['label' => 'Active Plans', 'value' => $s['totalPlans'] ?? 0, 'sub' => 'Investment plans online', 'ico' => 'trending-up'])
    @include('admin.partials.stat', ['label' => 'Approvals (30d)', 'value' => $s['approvals30d'] ?? 0, 'sub' => 'Audited admin actions', 'ico' => 'dashboard'])
</div>

<div class="adm-card adm-card-pad">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <b style="font-size:14px">{{ $tx('Priority queue') }}</b>
        <span style="font-size:12px;color:var(--dash-muted)">{{ $tx('Updated live') }}</span>
    </div>
    <div class="adm-notice" style="margin-bottom:10px">
        <x-dash-icon name="arrow-down" />
        <span><b style="color:var(--dash-text)">{{ $pd['count'] }} deposit request(s)</b> {{ $tx('totaling') }} <b style="color:var(--dash-text)">{{ $m($pd['sumCents']) }}</b> {{ $tx('are under review. Head to') }} <a class="adm-link-btn" href="/admin/requests">{{ $tx('Requests') }}</a> {{ $tx('to approve or reject them.') }}</span>
    </div>
    <div class="adm-notice" style="margin-bottom:10px">
        <x-dash-icon name="arrow-up" />
        <span><b style="color:var(--dash-text)">{{ $pw['count'] }} withdrawal request(s)</b> {{ $tx('totaling') }} <b style="color:var(--dash-text)">{{ $m($pw['sumCents']) }}</b> {{ $tx('are under review — funds are already reserved for these payouts.') }}</span>
    </div>
    <div class="adm-notice">
        <x-dash-icon name="wallet" />
        <span><b style="color:var(--dash-text)">{{ $s['pendingLoans'] ?? 0 }} pending loan application(s)</b> {{ $tx('in the queue. Review them in the Loans section.') }}</span>
    </div>
</div>
@endsection
