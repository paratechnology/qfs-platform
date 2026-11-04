@extends('layouts.admin')
@section('title', 'Documents | QFS')

@section('admin-content')
<div x-data="admContent({ resource: 'documents', defaults: { sort: 0, isActive: true } })">
    <div class="adm-page-head"><div><h1>{{ $tx('Documents') }}</h1><p>Company PDFs available to users in their dashboard.</p></div><div class="adm-page-actions"><button class="adm-btn primary" @click="openNew()">New document</button></div></div>

    <template x-if="toast"><div class="adm-banner" role="status" x-text="toast"></div></template>
    <template x-if="error"><div class="adm-banner error"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">Retry</button></div></template>
    <template x-if="loading && !rows.length"><div class="adm-loading"><span class="adm-spinner" aria-hidden="true"></span> Loading…</div></template>
    <template x-if="!loading && rows.length === 0"><div class="adm-empty"><b>No documents yet</b></div></template>

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead><tr><th>Code</th><th>Title</th><th>File</th><th>Active</th><th class="num"></th></tr></thead>
            <tbody>
                <template x-for="r in rows" :key="r.id">
                    <tr>
                        <td x-text="r.code"></td><td x-text="r.title"></td>
                        <td><template x-if="r.fileUrl"><a :href="r.fileUrl" target="_blank" rel="noreferrer">Open</a></template><template x-if="!r.fileUrl"><span>—</span></template></td>
                        <td x-text="r.isActive ? 'Yes' : 'No'"></td>
                        <td class="num"><div class="adm-actions-cell"><button class="adm-btn ghost sm" @click="openEdit(r)">Edit</button><button class="adm-btn danger sm" :disabled="busy" @click="remove(r.id)">Delete</button></div></td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>

    <div class="adm-modal-overlay" x-show="editing" x-cloak @click.self="close()">
        <div class="adm-modal" role="dialog" aria-modal="true">
            <div class="adm-modal-head"><h3 x-text="editing === 'new' ? 'New document' : 'Edit document'"></h3><button class="adm-modal-close" :disabled="busy" @click="close()"><x-dash-icon name="close" /></button></div>
            <div class="adm-modal-body"><fieldset class="adm-modal-fieldset" :disabled="busy">
                <div class="adm-field"><label>Code</label><input class="adm-input" x-model="form.code" placeholder="e.g. nesara-pdf"></div>
                <div class="adm-field"><label>Title</label><input class="adm-input" x-model="form.title"></div>
                <div class="adm-field"><label>Flag path</label><input class="adm-input" x-model="form.flagPath" placeholder="/dashboard/flags/en-us.svg"></div>
                <div class="adm-field"><label for="document-pdf">{{ $tx('Upload PDF') }}</label><input id="document-pdf" class="adm-input" type="file" accept="application/pdf" @change="uploadFile = $event.target.files[0] || null"><span class="adm-field-hint">{{ $tx('PDF, up to 10 MB. Replacing a document preserves copies referenced by existing investments.') }}</span></div>
                <div class="adm-field"><label>File URL</label><input class="adm-input" x-model="form.fileUrl" placeholder="/path.pdf or https://…"><span class="adm-field-hint">Use a site path or an https:// link.</span></div>
                <label class="adm-swap-check"><input type="checkbox" x-model="form.isActive"> Active</label>
                <template x-if="formError"><div class="adm-banner error" x-text="formError"></div></template>
                <div class="adm-row-end"><button class="adm-btn ghost" @click="close()" :disabled="busy">Cancel</button><button class="adm-btn primary" @click="save()" :disabled="busy"><span x-text="busy ? 'Saving…' : 'Save'"></span></button></div>
            </fieldset></div>
        </div>
    </div>
</div>
@endsection
