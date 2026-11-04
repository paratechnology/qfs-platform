@extends('layouts.admin')
@section('title', 'Reconciliation | QFS')

@section('admin-content')
<div x-data="admData({ endpoint: '/api/admin/reconciliation' })">
    <div class="adm-page-head">
        <div><h1>Balance reconciliation</h1><p>{{ $tx('Checks account reservations, latest ledger balances and completed swap records. No balances are changed.') }}</p></div>
        <div class="adm-page-actions"><button class="adm-btn ghost" @click="load()" :disabled="loading">Run checks again</button></div>
    </div>
    <p class="adm-banner">This checks internal records. It does not verify treasury assets on the blockchain or reconstruct the complete historical ledger.</p>

    <template x-if="error"><div class="adm-banner error" role="alert"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">Retry</button></div></template>
    <template x-if="loading && !data"><div class="adm-loading" role="status"><span class="adm-spinner" aria-hidden="true"></span> Checking account records…</div></template>

    <template x-if="data">
        <div>
            <p><span x-text="'Checked ' + (data.items ? data.items.length : 0) + ' accounts on this page'"></span> · <span x-text="date(data.checkedAt)"></span></p>
            <div class="adm-table-wrap">
                <table class="adm-table">
                    <thead><tr><th>Account</th><th>Checks</th></tr></thead>
                    <tbody>
                        <template x-for="(row, i) in (data.items || [])" :key="i">
                            <tr>
                                <td><strong x-text="row.name"></strong><small style="display:block" x-text="row.email"></small></td>
                                <td>
                                    <template x-if="row.issues.length">
                                        <details>
                                            <summary x-text="row.issues.length + ' discrepancies'"></summary>
                                            <template x-for="(issue, j) in row.issues" :key="j">
                                                <div class="account-reconciliation-issue"><code x-text="issue.code + ' · ' + issue.asset"></code><p>Expected: <span x-text="issue.expected"></span><br>Recorded: <span x-text="issue.actual"></span></p></div>
                                            </template>
                                        </details>
                                    </template>
                                    <template x-if="!row.issues.length"><span>No discrepancies found</span></template>
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>
        </div>
    </template>
</div>
@endsection
