<div class="account-statements" x-data="statements()">
    <form class="account-statement-toolbar" @submit.prevent="load($event)">
        <label>From <input type="date" class="dash-input" x-model="from" required :disabled="busy"></label>
        <label>To <input type="date" class="dash-input" x-model="to" required :disabled="busy"></label>
        <button class="dash-btn primary" :disabled="busy"><span x-text="busy ? 'Loading…' : 'Apply period'"></span></button>
    </form>

    <template x-if="error"><p class="dash-form-error" role="alert"><span x-text="error"></span> <button class="dash-btn ghost" @click="load()">Retry</button></p></template>
    <template x-if="busy && !data"><p class="dash-input-note" role="status">Preparing account statement…</p></template>

    <template x-if="data">
        <div>
            <header>
                <h2><span x-text="data.from"></span> — <span x-text="data.to"></span></h2>
                <p>{{ $tx('Activity timestamps use UTC. Downloads include the full selected period.') }}</p>
                <div class="dash-actions-row">
                    <a class="dash-btn ghost" :href="path + '&format=csv'">Download CSV</a>
                    <a class="dash-btn ghost" :href="path + '&format=print'" target="_blank" rel="noreferrer">Print / save as PDF</a>
                </div>
            </header>
            <p class="account-hint">Current USD balance <span x-text="money(data.balanceCents)"></span> · Available <span x-text="money(data.availableCents)"></span></p>
            <div class="account-statement-table">
                <table>
                    <thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Status</th><th>Amount</th><th>Fee</th></tr></thead>
                    <tbody>
                        <template x-for="row in data.transactions" :key="row.reference">
                            <tr>
                                <td x-text="date(row.createdAt)"></td>
                                <td><code x-text="row.reference"></code></td>
                                <td x-text="label(row.type)"></td>
                                <td x-text="label(row.status)"></td>
                                <td x-text="row.displayAmount"></td>
                                <td x-text="money(row.feeCents)"></td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>
            <template x-if="!data.transactions.length"><p class="dash-input-note">No activity in this period.</p></template>
        </div>
    </template>
</div>
