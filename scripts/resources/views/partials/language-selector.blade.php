<div class="language-control" x-data="languageSelector()" x-cloak>
    <label class="language-selector" :aria-busy="pending">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18"/></svg>
        <span class="language-sr-only">{{ $tx('Language') }}</span>
        <select :value="locale" :disabled="pending" @change="change($event.target.value)">
            @foreach ($localeLanguages as $language)
                <option value="{{ $language['code'] }}" lang="{{ $language['code'] }}" data-abbr="{{ $language['abbr'] }}" @selected(app()->getLocale() === $language['code'])>{{ $language['name'] }}</option>
            @endforeach
        </select>
        <span class="language-spinner" aria-hidden="true" x-show="pending"></span>
    </label>
    <span class="language-sr-only" role="status" x-text="pending ? @js($tx('Changing language…')) : ''"></span>
    <span class="language-error" role="alert" x-show="error" x-text="error"></span>
</div>
