@extends('layouts.admin')
@section('title', 'Reviews | QFS')

@section('admin-content')
<div x-data="admContent({ resource: 'reviews', defaults: { rating: 5, status: 'APPROVED', sort: 0, imageUrl: '/avatars/avatar1.jpg' } })">
    <div class="adm-page-head"><div><h1>Reviews</h1><p>{{ $tx('Testimonials shown in the user dashboard. Only APPROVED reviews are visible to users.') }}</p></div><div class="adm-page-actions"><button class="adm-btn primary" @click="openNew()">New review</button></div></div>

    <template x-if="toast"><div class="adm-banner" role="status" x-text="toast"></div></template>
    <template x-if="error"><div class="adm-banner error"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">Retry</button></div></template>
    <template x-if="loading && !rows.length"><div class="adm-loading"><span class="adm-spinner" aria-hidden="true"></span> Loading…</div></template>
    <template x-if="!loading && rows.length === 0"><div class="adm-empty"><b>No reviews yet</b></div></template>

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead><tr><th>Photo</th><th>Name</th><th>Country</th><th>Rating</th><th>Review</th><th>Status</th><th class="num"></th></tr></thead>
            <tbody>
                <template x-for="r in rows" :key="r.id">
                    <tr>
                        <td><img :src="r.imageUrl || r.avatarUrl || '/avatars/avatar1.jpg'" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover"></td>
                        <td x-text="r.userName"></td><td x-text="r.country || '—'"></td><td x-text="r.rating + '★'"></td>
                        <td><span style="display:block;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" x-text="r.text"></span></td>
                        <td x-text="cap(r.status)"></td>
                        <td class="num"><div class="adm-actions-cell"><button class="adm-btn ghost sm" @click="openEdit(r)">Edit</button><button class="adm-btn danger sm" :disabled="busy" @click="remove(r.id)">Delete</button></div></td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>

    <div class="adm-modal-overlay" x-show="editing" x-cloak @click.self="close()">
        <div class="adm-modal" role="dialog" aria-modal="true">
            <div class="adm-modal-head"><h3 x-text="editing === 'new' ? 'New review' : 'Edit review'"></h3><button class="adm-modal-close" :disabled="busy" @click="close()"><x-dash-icon name="close" /></button></div>
            <div class="adm-modal-body"><fieldset class="adm-modal-fieldset" :disabled="busy">
                <div class="adm-field"><label>Name</label><input class="adm-input" x-model="form.userName"></div>
                <div class="adm-field"><label>Country</label><input class="adm-input" x-model="form.country"></div>
                <div class="adm-field">
                    <label>{{ $tx('Reviewer image') }}</label>
                    <input class="adm-input" x-model="form.imageUrl" placeholder="/avatars/avatar1.jpg or https://…">
                    <span class="adm-field-hint">{{ $tx('Shown on the dashboard review reel and reviews tab.') }}</span>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
                        <template x-for="preset in ['/avatars/avatar1.jpg','/avatars/avatar2.jpg','/avatars/avatar3.jpg','/avatars/avatar4.jpg']" :key="preset">
                            <button type="button" class="adm-btn ghost sm" @click="form.imageUrl = preset" :aria-pressed="form.imageUrl === preset">
                                <img :src="preset" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;vertical-align:middle">
                            </button>
                        </template>
                    </div>
                    <template x-if="form.imageUrl">
                        <img :src="form.imageUrl" alt="" style="display:block;width:72px;height:72px;border-radius:50%;object-fit:cover;margin-top:12px">
                    </template>
                </div>
                <div class="adm-field"><label>Rating</label><select class="adm-select" x-model.number="form.rating"><option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1</option></select></div>
                <div class="adm-field"><label>{{ $tx('Review text') }}</label><textarea class="adm-textarea" rows="4" x-model="form.text"></textarea></div>
                <div class="adm-field"><label>{{ $tx('Status') }}</label><select class="adm-select" x-model="form.status"><option value="APPROVED">{{ $tx('Approved (visible)') }}</option><option value="HIDDEN">{{ $tx('Hidden') }}</option><option value="PENDING">{{ $tx('Pending') }}</option></select></div>
                <template x-if="formError"><div class="adm-banner error" x-text="formError"></div></template>
                <div class="adm-row-end"><button class="adm-btn ghost" @click="close()" :disabled="busy">Cancel</button><button class="adm-btn primary" @click="save()" :disabled="busy"><span x-text="busy ? 'Saving…' : 'Save'"></span></button></div>
            </fieldset></div>
        </div>
    </div>
</div>
@endsection
