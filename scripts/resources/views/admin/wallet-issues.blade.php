@extends('layouts.admin')
@section('title', 'Wallet Issues | QFS')

@section('admin-content')
<div x-data="admList({ endpoint: '/api/admin/wallet-issues', filters: { status: 'PENDING' } })">
    <div class="adm-page-head">
        <div>
            <h1>Wallet issues</h1>
            <p>{{ $tx('Reports from users who cannot detect or connect a wallet.') }}</p>
        </div>
    </div>

    <div class="adm-inline-form">
        <select class="adm-select" x-model="filters.status" @change="search()">
            <option value="PENDING">Pending reports and reviews</option>
            <option value="UNDER_REVIEW">Under review</option>
            <option value="APPROVED">Approved reviews</option>
            <option value="REJECTED">Declined reviews</option>
            <option value="OPEN">Open reports</option>
            <option value="RESOLVED">Resolved</option>
            <option value="ALL">All reports</option>
        </select>
    </div>

    @include('admin.partials.list-states', ['loadingLabel' => 'Loading wallet issues…'])

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead>
                <tr>
                    <th>{{ $tx('User') }}</th>
                    <th>Issue</th>
                    <th>{{ $tx('Status') }}</th>
                    <th>{{ $tx('Submitted') }}</th>
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
                                <span class="adm-cell-sub" x-show="item.walletProvider" x-text="item.walletProvider + ' · ' + item.assetKey"></span>
                                <bdi class="adm-cell-sub" x-show="item.publicAddress" x-text="item.publicAddress"></bdi>
                                <p class="adm-field-hint" x-show="item.subject === 'MANUAL_REVIEW'">Approval records a support review. It does not verify wallet ownership or grant wallet access.</p>
                                <textarea class="adm-textarea" x-show="item.status === 'UNDER_REVIEW'" x-model="item.reviewNote" maxlength="500" :aria-label="'Review note for ' + item.userName" placeholder="Review note (required when declining)"></textarea>
                                <span class="adm-cell-sub" x-show="item.status !== 'UNDER_REVIEW' && item.reviewNote" x-text="item.reviewNote"></span>
                                <span class="adm-cell-sub" x-show="item.pageUrl" x-text="item.pageUrl"></span>
                            </div>
                        </td>
                        <td><span class="adm-pill" :class="pill(item.status)" x-text="cap(item.status)"></span></td>
                        <td style="white-space:nowrap" x-text="date(item.createdAt)"></td>
                        <td class="num">
                            <div class="adm-actions-cell">
                                <button type="button" class="adm-btn good sm" x-show="item.status === 'OPEN'" :disabled="loading" @click="act('/api/admin/wallet-issues/' + item.id, 'PATCH', { action: 'RESOLVE' }, 'Marked resolved.')">Mark resolved</button>
                                <button type="button" class="adm-btn good sm" x-show="item.status === 'UNDER_REVIEW'" :disabled="loading" @click="act('/api/admin/wallet-issues/' + item.id, 'PATCH', { action: 'APPROVE', note: item.reviewNote || '' }, 'Wallet review approved. Notification created.')">Approve review</button>
                                <button type="button" class="adm-btn danger sm" x-show="item.status === 'UNDER_REVIEW'" :disabled="loading" @click="act('/api/admin/wallet-issues/' + item.id, 'PATCH', { action: 'REJECT', note: item.reviewNote || '' }, 'Wallet review declined. Notification created.')">Decline review</button>
                                <button type="button" class="adm-btn danger sm" :disabled="loading" @click="if (confirm('Delete this wallet issue?')) act('/api/admin/wallet-issues/' + item.id, 'DELETE', undefined, 'Report deleted.')">{{ $tx('Delete') }}</button>
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
