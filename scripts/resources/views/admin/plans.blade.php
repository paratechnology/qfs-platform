@extends('layouts.admin')
@section('title', 'Investment Plans | QFS')

@section('admin-content')
<div x-data="admContent({
    resource: 'plans',
    defaults: { documentIds: [], translations: {}, payoutInterval: 'MONTHLY', principalRelease: 'AUTOMATIC', termMonths: 12, isActive: true, sort: 0 },
    mapEdit: (r) => {
        const c = { ...r };
        c.documentIds = typeof r.documentIds === 'string' ? JSON.parse(r.documentIds || '[]') : (r.documentIds || []);
        c.translations = typeof r.translations === 'string' ? JSON.parse(r.translations || '{}') : (r.translations || {});
        delete c.minAmountCents; delete c.maxAmountCents; delete c.monthlyRoiBps;
        c.minAmount = r.minAmountCents != null ? r.minAmountCents / 100 : '';
        c.maxAmount = r.maxAmountCents != null ? r.maxAmountCents / 100 : null;
        c.monthlyRoiPct = r.monthlyRoiBps != null ? r.monthlyRoiBps / 100 : '';
        return c;
    }
})">
    <div class="adm-page-head"><div><h1>{{ $tx('Investment Plans') }}</h1><p>Plans offered to investors: rates, terms and payout schedules.</p></div><div class="adm-page-actions"><button class="adm-btn primary" @click="openNew()">New plan</button></div></div>

    <template x-if="toast"><div class="adm-banner" role="status" x-text="toast"></div></template>
    <template x-if="error"><div class="adm-banner error"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">{{ $tx('Retry') }}</button></div></template>
    <template x-if="loading && !rows.length"><div class="adm-loading"><span class="adm-spinner" aria-hidden="true"></span> {{ $tx('Loading…') }}</div></template>
    <template x-if="!loading && rows.length === 0"><div class="adm-empty"><b>No plans yet</b></div></template>

    <div class="adm-table-wrap" x-show="rows.length" x-cloak>
        <table class="adm-table">
            <thead><tr><th>{{ $tx('Name') }}</th><th>{{ $tx('Monthly ROI') }}</th><th>{{ $tx('Term') }}</th><th>{{ $tx('Min') }}</th><th>{{ $tx('Max') }}</th><th>{{ $tx('Active') }}</th><th class="num"></th></tr></thead>
            <tbody>
                <template x-for="r in rows" :key="r.id">
                    <tr>
                        <td x-text="r.name"></td>
                        <td x-text="(r.monthlyRoiBps / 100) + '%'"></td>
                        <td x-text="r.termMonths + ' mo'"></td>
                        <td class="num" x-text="money(r.minAmountCents)"></td>
                        <td class="num" x-text="r.maxAmountCents != null ? money(r.maxAmountCents) : '—'"></td>
                        <td x-text="r.isActive ? 'Yes' : 'No'"></td>
                        <td class="num"><div class="adm-actions-cell"><button class="adm-btn ghost sm" @click="openEdit(r)">{{ $tx('Edit') }}</button><button class="adm-btn danger sm" :disabled="busy" @click="remove(r.id)">{{ $tx('Delete') }}</button></div></td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>

    <div class="adm-modal-overlay" x-show="editing" x-cloak @click.self="close()">
        <div class="adm-modal wide" role="dialog" aria-modal="true">
            <div class="adm-modal-head"><h3 x-text="editing === 'new' ? 'New plan' : 'Edit plan'"></h3><button class="adm-modal-close" :disabled="busy" @click="close()"><x-dash-icon name="close" /></button></div>
            <div class="adm-modal-body"><fieldset class="adm-modal-fieldset" :disabled="busy">
                <div class="adm-field"><label>{{ $tx('Name') }}</label><input class="adm-input" x-model="form.name"></div>
                <div class="adm-field"><label>Description</label><textarea class="adm-textarea" rows="2" x-model="form.description"></textarea></div>
                <div class="adm-field"><label>{{ $tx('Minimum amount (USD)') }}</label><input class="adm-input" inputmode="decimal" x-model="form.minAmount"></div>
                <div class="adm-field"><label>{{ $tx('Maximum amount (USD, optional)') }}</label><input class="adm-input" inputmode="decimal" x-model="form.maxAmount"></div>
                <div class="adm-field"><label>{{ $tx('Monthly ROI (%)') }}</label><input class="adm-input" inputmode="decimal" x-model="form.monthlyRoiPct"></div>
                <div class="adm-field"><label>{{ $tx('Term (months)') }}</label><input class="adm-input" type="number" x-model.number="form.termMonths"></div>
                <div class="adm-field"><label>{{ $tx('Payout interval') }}</label><select class="adm-select" x-model="form.payoutInterval"><option value="MONTHLY">{{ $tx('Monthly') }}</option><option value="HOURLY">{{ $tx('Hourly') }}</option></select></div>
                <div class="adm-field"><label>{{ $tx('Principal release') }}</label><select class="adm-select" x-model="form.principalRelease"><option value="AUTOMATIC">{{ $tx('Automatic') }}</option><option value="MANUAL">{{ $tx('Manual') }}</option></select></div>
                <div class="adm-field"><label>Terms (optional)</label><textarea class="adm-textarea" rows="2" x-model="form.terms"></textarea></div>
                <div class="adm-field"><label>Risk disclosure (optional)</label><textarea class="adm-textarea" rows="2" x-model="form.riskDisclosure"></textarea></div>
                <div class="adm-field"><label>{{ $tx('Supporting documents') }}</label><template x-for="document in documents" :key="document.id"><label class="adm-swap-check"><input type="checkbox" :value="document.id" x-model="form.documentIds"><span x-text="document.title"></span></label></template><p class="adm-note">{{ $tx('Selected documents are recorded with new investments. Existing investment terms remain unchanged.') }}</p></div>
                <details class="adm-field"><summary>{{ $tx('Plan translations') }}</summary>
                    <label for="plan-language">{{ $tx('Language') }}</label><select id="plan-language" class="adm-select" x-model="translationLocale" @change="selectTranslation()">@foreach (\App\Support\LocaleHtml::languages() as $language)@if ($language['code'] !== 'en')<option value="{{ $language['code'] }}">{{ $language['name'] }}</option>@endif @endforeach</select>
                    <label>{{ $tx('Translated description') }}</label><textarea class="adm-textarea" x-model="translationDraft.description" @input="translationReviewed = false"></textarea>
                    <label>{{ $tx('Translated plan terms') }}</label><textarea class="adm-textarea" x-model="translationDraft.terms" @input="translationReviewed = false"></textarea>
                    <label>{{ $tx('Translated risk disclosure') }}</label><textarea class="adm-textarea" x-model="translationDraft.riskDisclosure" @input="translationReviewed = false"></textarea>
                    <label class="adm-swap-check"><input type="checkbox" x-model="translationReviewed">{{ $tx('I have reviewed this translation against the current English materials.') }}</label>
                    <div class="adm-row-end"><button class="adm-btn ghost" type="button" @click="removeTranslation()">{{ $tx('Remove translation') }}</button><button class="adm-btn primary" type="button" @click="applyTranslation()">{{ $tx('Apply reviewed translation') }}</button></div>
                    <p class="adm-note" x-show="form.translations?.[translationLocale]">{{ $tx('Translation is included when you save this plan.') }}</p>
                </details>
                <label class="adm-swap-check"><input type="checkbox" x-model="form.isActive"> {{ $tx('Active') }}</label>
                <template x-if="formError"><div class="adm-banner error" x-text="formError"></div></template>
                <div class="adm-row-end"><button class="adm-btn ghost" @click="close()" :disabled="busy">{{ $tx('Cancel') }}</button><button class="adm-btn primary" @click="save()" :disabled="busy"><span x-text="busy ? 'Saving…' : 'Save'"></span></button></div>
            </fieldset></div>
        </div>
    </div>
</div>
@endsection
