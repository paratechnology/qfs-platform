@extends('layouts.admin')
@section('title', 'Users | QFS')
@section('admin-content')
<div x-data="admUsers()">
    <div class="adm-page-head"><div><h1>{{ $tx('Users') }}</h1><p>Every account on the platform. Suspend, change status or adjust balances — all actions are audited.</p></div><button class="adm-btn primary" @click="openAdjustAll()">{{ $tx('Adjust all users') }}</button></div>
    <form class="adm-toolbar" @submit.prevent="search()">
        <input class="adm-input" placeholder="{{ $tx('Search name or email') }}" x-model="query" maxlength="200">
        <select class="adm-input" x-model="role" @change="search()"><option value="ALL">{{ $tx('All roles') }}</option><option value="USER">{{ $tx('Users') }}</option><option value="ADMIN">{{ $tx('Admins') }}</option></select>
        <select class="adm-input" x-model="status" @change="search()"><option value="ALL">{{ $tx('All statuses') }}</option><option value="ACTIVE">{{ $tx('Active') }}</option><option value="SUSPENDED">{{ $tx('Suspended') }}</option></select>
        <button class="adm-btn ghost" type="submit">{{ $tx('Search') }}</button>
    </form>
    <template x-if="toast"><div class="adm-banner" role="status" style="margin-bottom:12px"><span x-text="toast"></span></div></template>
    <template x-if="error"><div class="adm-banner error"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">{{ $tx('Retry') }}</button></div></template>
    <template x-if="loading && !rows.length"><div class="adm-loading"><span class="adm-spinner" aria-hidden="true"></span> {{ $tx('Loading users…') }}</div></template>
    <template x-if="!loading && !error && rows.length === 0"><div class="adm-empty"><b>No users found</b></div></template>
    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead><tr><th>{{ $tx('User') }}</th><th>{{ $tx('Email') }}</th><th>{{ $tx('Contact') }}</th><th>{{ $tx('Role') }}</th><th>{{ $tx('Status') }}</th><th>{{ $tx('KYC') }}</th><th>{{ $tx('Wallet') }}</th><th>{{ $tx('Balance') }}</th><th>{{ $tx('Available USD') }}</th><th>{{ $tx('USD deposits') }}</th><th>{{ $tx('Withdrawals') }}</th><th>{{ $tx('Referred') }}</th><th>{{ $tx('Member since') }}</th><th class="num"></th></tr></thead>
            <tbody>
                <template x-for="u in rows" :key="u.id">
                    <tr>
                        <td><div class="adm-user-cell"><img :src="u.avatarUrl || '/avatars/avatar1.jpg'" alt=""><div><b x-text="u.name"></b><span x-text="u.referralCode"></span><button type="button" class="adm-btn ghost sm adm-edit-account" :disabled="busy" x-show="u.id !== @js($adminUser['id'])" @click="openEdit(u)">{{ $tx('Edit account') }}</button><a class="adm-btn ghost sm adm-edit-account" href="/admin/security" x-show="u.id === @js($adminUser['id'])">{{ $tx('Account settings') }}</a></div></div></td>
                        <td><a class="adm-contact" :href="'mailto:' + u.email" x-text="u.email"></a></td>
                        <td><a class="adm-contact" x-show="u.phone" :href="'tel:' + (u.phone || '').replace(/[^0-9+]/g, '')" x-text="u.phone"></a><span x-show="!u.phone">{{ $tx('Not provided') }}</span></td>
                        <td><span class="adm-pill" :class="pill(u.role)" x-text="cap(u.role)"></span></td>
                        <td><span class="adm-pill" :class="pill(u.status)" x-text="cap(u.status)"></span></td>
                        <td x-text="'Level ' + u.kycLevel"></td>
                        <td><span class="adm-wallet-cell" x-text="u.walletAddress || '—'"></span></td>
                        <td><span class="num" x-text="money(u.balanceCents)"></span><span class="adm-cell-sub">{{ $tx('USD account') }}</span><template x-for="asset in (u.cryptoBalances || [])" :key="asset.assetKey"><span class="adm-cell-sub"><bdi x-text="asset.quantity + ' ' + asset.symbol"></bdi><span x-text="' · ' + asset.network"></span><small x-show="asset.reserved !== '0'" x-text="'Reserved: ' + asset.reserved"></small></span></template></td>
                        <td><span class="num" x-text="money(u.availableCents)"></span></td>
                        <td><span class="num" x-text="money(u.depositCents)"></span></td><td><span class="num" x-text="money(u.withdrawalCents)"></span></td><td x-text="u.referredCount"></td>
                        <td style="white-space:nowrap" x-text="date(u.memberSince)"></td>
                        <td class="num">
                            <div class="adm-actions-cell">
                                <button class="adm-btn ghost sm" :disabled="busy || u.role === 'ADMIN'" @click="openAdjust(u)">{{ $tx('Adjust') }}</button>
                                <button class="adm-btn danger sm" :disabled="busy || u.id === @js($adminUser['id'])" @click="openDelete(u)">{{ $tx('Delete') }}</button>
                                <template x-if="u.role !== 'ADMIN'"><button class="adm-btn ghost sm" :disabled="busy" @click="userAction(u.id, 'SET_ROLE', 'ADMIN')">{{ $tx('Make admin') }}</button></template>
                                <template x-if="u.role === 'ADMIN'"><button class="adm-btn ghost sm" :disabled="busy || u.id === @js($adminUser['id'])" @click="userAction(u.id, 'SET_ROLE', 'USER')">Make user</button></template>
                                <template x-if="u.status === 'ACTIVE'"><button class="adm-btn danger sm" :disabled="busy || u.id === @js($adminUser['id'])" @click="userAction(u.id, 'SUSPEND')">{{ $tx('Suspend') }}</button></template>
                                <template x-if="u.status !== 'ACTIVE'"><button class="adm-btn good sm" :disabled="busy" @click="userAction(u.id, 'ACTIVATE')">{{ $tx('Activate') }}</button></template>
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
            <div class="adm-modal-head"><h3 x-text="adjust?.scope === 'ALL' ? 'Adjust all users' : 'Adjust balance'"></h3><button class="adm-modal-close" :disabled="busy" @click="closeAdjust()"><x-dash-icon name="close" /></button></div>
            <div class="adm-modal-body"><fieldset class="adm-modal-fieldset" :disabled="busy">
                <p class="adm-confirm-text" x-show="adjust?.scope !== 'ALL'"><b style="color:var(--dash-text)" x-text="adjust && adjust.name"></b> · current available <span x-text="adjust && money(adjust.availableCents)"></span></p><p class="adm-confirm-text" x-show="adjust?.scope === 'ALL'">{{ $tx('Applies to every non-admin account, active and suspended alike. Admins are excluded.') }}</p>
                <div class="adm-field"><label>{{ $tx('Direction') }}</label><select class="adm-select" x-model="adjDir"><option value="CREDIT">Credit (add funds)</option><option value="DEBIT">Debit (remove funds)</option></select></div>
                <div class="adm-field"><label>{{ $tx('Amount (USD)') }}</label><input class="adm-input" inputmode="decimal" x-model="adjAmount" placeholder="100.00"></div>
                <div class="adm-field"><label>Reason / note</label><textarea class="adm-textarea" x-model="adjNote" minlength="3" required></textarea></div>
                <template x-if="adjError"><div class="adm-banner error" x-text="adjError"></div></template>
                <div class="adm-row-end">
                    <button class="adm-btn ghost" @click="closeAdjust()" :disabled="busy">{{ $tx('Cancel') }}</button>
                    <button class="adm-btn primary" :disabled="busy || !adjAmount || adjNote.trim().length < 3" @click="submitAdjust()"><span x-text="busy ? 'Working…' : 'Apply adjustment'"></span></button>
                </div>
            </fieldset></div>
        </div>
    </div>
    {{-- Edit profile --}}
    <div class="adm-modal-overlay" x-show="editing" x-cloak @click.self="closeEdit()">
        <div class="adm-modal" role="dialog" aria-modal="true" aria-labelledby="edit-account-title">
            <div class="adm-modal-head"><h3 id="edit-account-title">{{ $tx('Edit account') }}</h3><button type="button" class="adm-modal-close" aria-label="{{ $tx('Close') }}" :disabled="busy" @click="closeEdit()"><x-dash-icon name="close" /></button></div>
            <form class="adm-modal-body" @submit.prevent="saveProfile()" :aria-busy="busy"><fieldset class="adm-modal-fieldset" :disabled="busy">
                <p class="adm-field-hint" x-text="editing?.email"></p>
                <div class="adm-field"><label for="edit-name">{{ $tx('Display name') }}</label><input id="edit-name" class="adm-input" x-model="editForm.name" autocomplete="name" minlength="2" maxlength="120" required></div>
                <div class="adm-field"><label for="edit-email">{{ $tx('Email') }}</label><input id="edit-email" class="adm-input" type="email" x-model="editForm.email" autocomplete="email" maxlength="200" required><p class="adm-field-hint">Changing the email signs the user out of all devices.</p></div>
                <div class="adm-field"><label for="edit-phone">{{ $tx('Phone') }}</label><input id="edit-phone" class="adm-input" type="tel" x-model="editForm.phone" autocomplete="tel" minlength="7" maxlength="24"></div>
                <div class="adm-field"><label for="edit-country">{{ $tx('Country') }}</label><input id="edit-country" class="adm-input" x-model="editForm.country" autocomplete="country-name" minlength="2" maxlength="80" required></div>
                <div class="adm-field"><label for="edit-reason">{{ $tx('Reason for change') }}</label><input id="edit-reason" class="adm-input" x-model="editForm.reason" required minlength="3" maxlength="300"></div>
                <div class="adm-field"><label for="edit-password">Your current admin password</label><input id="edit-password" class="adm-input" type="password" autocomplete="current-password" x-model="editForm.currentPassword" required maxlength="200"></div>
                <div class="adm-field"><label for="edit-code">Authenticator or recovery code (if enabled)</label><input id="edit-code" class="adm-input" autocomplete="one-time-code" maxlength="30" x-model="editForm.code"></div>
                <p class="adm-field-hint">Changes are recorded in the audit log. Verified identity details are managed through KYC review.</p>
                <template x-if="error"><div class="adm-banner error" role="alert" x-text="error"></div></template>
                <div class="adm-row-end"><button type="button" class="adm-btn ghost" @click="closeEdit()" :disabled="busy">{{ $tx('Cancel') }}</button><button type="submit" class="adm-btn primary" :disabled="busy"><span class="adm-spinner" x-show="busy" aria-hidden="true"></span><span x-text="busy ? 'Saving…' : 'Save changes'"></span></button></div>
            </fieldset></form>
        </div>
    </div>
    <template x-if="deleting">
        <div class="adm-modal-overlay" @click.self="closeDelete()">
            <div class="adm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-user-title">
                <div class="adm-modal-head"><h3 id="delete-user-title">Delete account</h3><button type="button" class="adm-modal-close" aria-label="{{ $tx('Close') }}" :disabled="busy" @click="closeDelete()"><x-dash-icon name="close" /></button></div>
                <form class="adm-modal-body" @submit.prevent="deleteUser()"><fieldset class="adm-modal-fieldset" :disabled="busy">
                    <p class="adm-confirm-text">Delete access for <strong x-text="deleting.name"></strong> (<span x-text="deleting.email"></span>)? This removes the user from the list and signs out their devices. Financial and audit records are retained.</p>
                    <div class="adm-field"><label for="delete-confirmation">Type the account email to confirm</label><input id="delete-confirmation" class="adm-input" type="email" autocomplete="off" required x-model="deleteForm.confirmation"></div>
                    <div class="adm-field"><label for="delete-reason">Reason for deletion</label><input id="delete-reason" class="adm-input" required minlength="3" maxlength="300" x-model="deleteForm.reason"></div>
                    <div class="adm-field"><label for="delete-password">Your current admin password</label><input id="delete-password" class="adm-input" type="password" autocomplete="current-password" required x-model="deleteForm.currentPassword"></div>
                    <div class="adm-field"><label for="delete-code">Authenticator or recovery code (if enabled)</label><input id="delete-code" class="adm-input" autocomplete="one-time-code" x-model="deleteForm.code"></div>
                    <p class="adm-banner error" x-show="deleteError" x-text="deleteError" role="alert"></p>
                    <div class="adm-row-end"><button type="button" class="adm-btn ghost" :disabled="busy" @click="closeDelete()">{{ $tx('Cancel') }}</button><button type="submit" class="adm-btn danger" :disabled="busy"><span x-text="busy ? 'Deleting…' : 'Delete account'"></span></button></div>
                </fieldset></form>
            </div>
        </div>
    </template>
</div>
@endsection
