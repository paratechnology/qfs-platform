@extends('layouts.admin')
@section('title', 'Audit Log | QFS')

@section('admin-content')
<div x-data="admList({ endpoint: '/api/admin/audit' })">
    <div class="adm-page-head"><div><h1>{{ $tx('Audit Log') }}</h1><p>{{ $tx('Immutable record of every admin action: approvals, rejections, role changes and content edits.') }}</p></div></div>

    @include('admin.partials.list-states', ['loadingLabel' => 'Loading audit log…'])

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead><tr><th>{{ $tx('When') }}</th><th>{{ $tx('Actor') }}</th><th>{{ $tx('Action') }}</th><th>{{ $tx('Target') }}</th><th>{{ $tx('Target ID') }}</th><th>{{ $tx('Meta') }}</th></tr></thead>
            <tbody>
                <template x-for="(a, i) in rows" :key="i">
                    <tr>
                        <td style="white-space:nowrap" x-text="date(a.createdAt)"></td>
                        <td><div><b x-text="a.actorName"></b><span class="adm-cell-sub" x-text="a.actorRole"></span></div></td>
                        <td><span class="adm-pill" :class="pill(a.action)" x-text="cap(a.action)"></span></td>
                        <td x-text="a.targetType"></td>
                        <td><span style="font-family:ui-monospace,monospace;font-size:11.5px" x-text="a.targetId || '—'"></span></td>
                        <td><span style="font-family:ui-monospace,monospace;font-size:11.5px;color:var(--dash-muted)" x-text="a.meta || '—'"></span></td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>

    @include('admin.partials.pagination')
</div>
@endsection
