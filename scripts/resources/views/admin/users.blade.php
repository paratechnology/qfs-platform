@extends('layouts.admin')
@section('title', 'Users | QFS')

@section('admin-content')
<div x-data="admUsers()">
    <div class="adm-page-head"><div><h1>Users</h1><p>Every account on the platform. Suspend, change status or adjust balances — all actions are audited.</p></div></div>

    <form class="adm-toolbar" @submit.prevent="search()">
        <input class="adm-input" placeholder={{ $tx('Search name or email') }} x-model="query" maxlength="200">
        <select class="adm-input" x-model="role" @change="search()"><option value="ALL">All roles</option><option value="USER">Users</option><option value="ADMIN">Admins</option></select>
        <select class="adm-input" x-model="status" @change="search()"><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select>
        <button class="adm-btn ghost" type="submit">Search</button>
    </form>

    <template x-if="toast"><div class="adm-banner" role="status" style="margin-bottom:12px"><span x-text="toast"></span></div></template>
    <template x-if="error"><div class="adm-banner error"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">Retry</button></div></template>
    <template x-if="loading && !rows.length"><div class="adm-loading"><span class="adm-spinner" aria-hidden="true"></span> Loading users…</div></template>
    <template x-if="!loading && !error && rows.length === 0"><div class="adm-empty"><b>No users found</b></div></template>

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Available</th><th>Deposits</th><th>Member since</th><th class="num"></th></tr></thead>
            <tbody>
                <template x-for="u in rows" :key="u.id">
                    <tr>
                        <td><div style="min-width:0"><b x-text="u.name"></b><span class="adm-cell-sub" x-text="u.email"></span></div></td>
                        <td><span class="adm-pill" :class="pill(u.role)" x-text="cap(u.role)"></span></td>
                        <td><span class="adm-pill" :class="pill(u.status)" x-text="cap(u.status)"></span></td>
                        <td><span class="num" x-text="money(u.availableCents)"></span></td>
                        <td><span class="num" x-text="money(u.depositCents)"></span></td>
                        <td style="white-space:nowrap" x-text="date(u.memberSince)"></td>
                        <td class="num">
                            <div class="adm-actions-cell">
                                <button class="adm-btn ghost sm" @click="openEdit(u)">Edit</button>
                                <button class="adm-btn ghost sm" @click="openAdjust(u)">Adjust</button>
                                <template x-if="u.role !== 'ADMIN'"><button class="adm-btn ghost sm" :disabled="busy" @click="userAction(u.id, 'SET_ROLE', 'ADMIN')">Make admin</button></template>
                                <template x-if="u.role === 'ADMIN'"><button class="adm-btn ghost sm" :disabled="busy" @click="userAction(u.id, 'SET_ROLE', 'USER')">Make user</button></template>
                                <template x-if="u.status === 'ACTIVE'"><button class="adm-btn danger sm" :disabled="busy" @click="userAction(u.id, 'SUSPEND')">Suspend</button></template>
                                <template x-if="u.status !== 'ACTIVE'"><button class="adm-btn good sm" :disabled="busy" @click="userAction(u.id, 'ACTIVATE')">Activate</button></template>
                            </div>
                        </td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>

    @include('admin.partials.pagination')

    {{-- Adjust balance --}}
    <div class="adm-modal-overlay" x-show="adjust" x-cloak @click.self="closeAdjust()">
        <div class="adm-modal" role="dialog" aria-modal="true">
            <div class="adm-modal-head"><h3>Adjust balance</h3><button class="adm-modal-close" :disabled="busy" @click="closeAdjust()"><x-dash-icon name="close" /></button></div>
            <div class="adm-modal-body"><fieldset class="adm-modal-fieldset" :disabled="busy">
                <p class="adm-confirm-text"><b style="color:var(--dash-text)" x-text="adjust && adjust.name"></b> · current available <span x-text="adjust && money(adjust.availableCents)"></span></p>
                <div class="adm-field"><label>Direction</label><select class="adm-select" x-model="adjDir"><option value="CREDIT">Credit (add funds)</option><option value="DEBIT">Debit (remove funds)</option></select></div>
                <div class="adm-field"><label>Amount (USD)</label><input class="adm-input" inputmode="decimal" x-model="adjAmount" placeholder="100.00"></div>
                <div class="adm-field"><label>Note (optional)</label><textarea class="adm-textarea" x-model="adjNote"></textarea></div>
                <template x-if="adjError"><div class="adm-banner error" x-text="adjError"></div></template>
                <div class="adm-row-end">
                    <button class="adm-btn ghost" @click="closeAdjust()" :disabled="busy">Cancel</button>
                    <button class="adm-btn primary" :disabled="busy || !adjAmount" @click="submitAdjust()"><span x-text="busy ? 'Working…' : 'Apply adjustment'"></span></button>
                </div>
            </fieldset></div>
        </div>
    </div>

    {{-- Edit profile --}}
    <div class="adm-modal-overlay" x-show="editing" x-cloak @click.self="closeEdit()">
        <div class="adm-modal" role="dialog" aria-modal="true">
            <div class="adm-modal-head"><h3>Edit account</h3><button class="adm-modal-close" :disabled="busy" @click="closeEdit()"><x-dash-icon name="close" /></button></div>
            <div class="adm-modal-body"><fieldset class="adm-modal-fieldset" :disabled="busy">
                <div class="adm-field"><label>Display name</label><input class="adm-input" x-model="editForm.name"></div>
                <div class="adm-field"><label>Email</label><input class="adm-input" type="email" x-model="editForm.email"></div>
                <div class="adm-field"><label>Phone</label><input class="adm-input" x-model="editForm.phone"></div>
                <div class="adm-field"><label>Country</label><input class="adm-input" x-model="editForm.country"></div>
                <template x-if="error"><div class="adm-banner error" x-text="error"></div></template>
                <div class="adm-row-end"><button class="adm-btn ghost" @click="closeEdit()" :disabled="busy">Cancel</button><button class="adm-btn primary" @click="saveProfile()" :disabled="busy"><span x-text="busy ? 'Saving…' : 'Save'"></span></button></div>
            </fieldset></div>
        </div>
    </div>
</div>
@endsection
