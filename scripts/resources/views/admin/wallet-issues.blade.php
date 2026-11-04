@extends('layouts.admin')
@section('title', 'Wallet Issues | QFS')

@section('admin-content')
<div x-data="admList({ endpoint: '/api/admin/wallet-issues', filters: { status: 'OPEN' } })">
    <div class="adm-page-head">
        <div>
            <h1>Wallet issues</h1>
            <p>{{ $tx('Reports from users who cannot detect or connect a wallet.') }}</p>
        </div>
    </div>

    <div class="adm-inline-form">
        <select class="adm-select" x-model="filters.status" @change="search()">
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
            <option value="ALL">All reports</option>
        </select>
    </div>

    @include('admin.partials.list-states', ['loadingLabel' => 'Loading wallet issues…'])

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead>
                <tr>
                    <th>User</th>
                    <th>Issue</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th class="num"></th>
                </tr>
            </thead>
            <tbody>
                <template x-for="item in rows" :key="item.id">
                    <tr>
                        <td>
                            <div style="min-width:0">
                                <b x-text="item.userName"></b>
                                <span class="adm-cell-sub" x-text="item.userEmail"></span>
                            </div>
                        </td>
                        <td>
                            <div>
                                <b x-text="cap(item.subject)"></b>
                                <span class="adm-cell-sub" x-text="item.message"></span>
                                <span class="adm-cell-sub" x-show="item.pageUrl" x-text="item.pageUrl"></span>
                            </div>
                        </td>
                        <td><span class="adm-pill" :class="pill(item.status)" x-text="cap(item.status)"></span></td>
                        <td style="white-space:nowrap" x-text="date(item.createdAt)"></td>
                        <td class="num">
                            <div class="adm-actions-cell">
                                <button type="button" class="adm-btn good sm" x-show="item.status === 'OPEN'" :disabled="loading" @click="act('/api/admin/wallet-issues/' + item.id, 'PATCH', { action: 'RESOLVE' }, 'Marked resolved.')">Mark resolved</button>
                                <button type="button" class="adm-btn danger sm" :disabled="loading" @click="if (confirm('Delete this wallet issue?')) act('/api/admin/wallet-issues/' + item.id, 'DELETE', undefined, 'Report deleted.')">Delete</button>
                            </div>
                        </td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>

    @include('admin.partials.pagination')
</div>
@endsection
