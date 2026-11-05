<section x-data="kycHistory({{ $historyEndpoint }})" class="dash-position-prose account-kyc-history">
    <button type="button" class="{{ $historyAdmin ?? false ? 'adm-btn ghost' : 'dash-btn ghost' }}" :disabled="loading" @click="load()" x-text="loading ? 'Loading…' : 'View verification history'"></button>
    <p x-show="error" x-text="error" role="alert"></p><p x-show="loaded && !items.length">{{ $tx('No previous revisions.') }}</p>
    <template x-for="revision in items" :key="revision.id"><details><summary><span x-text="'Version ' + revision.version + ' · ' + revision.status + ' · ' + date(revision.createdAt)"></span></summary>
        <p x-show="revision.reviewNote" x-text="revision.reviewNote"></p><dl><template x-for="(value, field) in revision.details" :key="field"><div><dt x-text="field"></dt><dd x-text="value"></dd></div></template></dl>
        <template x-for="file in revision.files" :key="file.id"><p><a :href="file.url" target="_blank" rel="noreferrer" x-text="file.kind.replaceAll('_', ' ')"></a></p></template>
    </details></template><button type="button" class="{{ $historyAdmin ?? false ? 'adm-btn ghost' : 'dash-btn ghost' }}" x-show="cursor" :disabled="loading" @click="load(true)">{{ $tx('Load more') }}</button>
</section>
