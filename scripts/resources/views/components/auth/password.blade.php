@props([
    'label',
    'id',
    'name',
    'placeholder' => '',
    'autocomplete' => 'new-password',
])
{{-- Password field with an Alpine-driven show/hide toggle. --}}
<div class="auth-field" x-data="{ show: false }">
    <label for="{{ $id }}">{{ $tx($label) }}</label>
    <div class="auth-input">
        <span class="auth-input-icon"><x-icon name="lock" :size="16" /></span>
        <input
            id="{{ $id }}"
            name="{{ $name }}"
            :type="show ? 'text' : 'password'"
            placeholder="{{ $tx($placeholder) }}"
            autocomplete="{{ $autocomplete }}"
            required
        >
        <button
            type="button"
            class="auth-input-right"
            :aria-label="show ? @js($tx('Hide password')) : 'Show password'"
            @click="show = !show"
        >
            <span x-show="!show"><x-icon name="eye" :size="18" /></span>
            <span x-show="show" x-cloak><x-icon name="eye-off" :size="18" /></span>
        </button>
    </div>
</div>
