<div class="dash-card dash-card-pad" x-data="loanList()">
    <template x-if="loading"><p class="dash-input-note" role="status">{{ $tx('Loading loans…') }}</p></template>
    <template x-if="error"><p class="dash-form-error" role="alert"><x-dash-icon name="info" :size="18" /> <span x-text="error"></span></p></template>
    <template x-if="!loading && !error && items.length === 0"><div class="dash-notice"><x-dash-icon name="info" /> You have no loan applications yet.</div></template>
    <div class="dash-market-table-wrap" x-show="items.length" style="overflow-x:auto" x-cloak>
        <table class="dash-market-table">
            <thead><tr><th>{{ $tx('Type') }}</th><th>{{ $tx('Amount') }}</th><th>{{ $tx('Status') }}</th><th>Applied</th><th>Due</th></tr></thead>
            <tbody>
                <template x-for="l in items" :key="l.id">
                    <tr>
                        <td x-text="l.type"></td>
                        <td x-text="money(l.amountCents) + ' ' + (l.currency || '')"></td>
                        <td><span class="dash-tx-status" :data-status="(l.status||'').toLowerCase()" x-text="cap(l.status)"></span></td>
                        <td x-text="date(l.createdAt)"></td>
                        <td x-text="date(l.dueDate)"></td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>
</div>
