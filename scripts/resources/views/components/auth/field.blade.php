@props([
    'label',
    'id',
    'name',
    'type' => 'text',
    'placeholder' => '',
    'autocomplete' => null,
    'icon' => null,
    'select' => false,
    'options' => [],
])
{{-- One auth form field: text/email/tel input, or a country <select>. --}}
<div class="auth-field">
    <label for="{{ $id }}">{{ $tx($label) }}</label>
    <div class="auth-input">
        @if ($icon)
            <span class="auth-input-icon"><x-icon :name="$icon" :size="16" /></span>
        @endif
        @if ($select)
            <select id="{{ $id }}" name="{{ $name }}" class="auth-select" required>
                <option value="" disabled selected>{{ $placeholder ?: $tx('Select…') }}</option>
                @foreach ($options as $option)
                    <option value="{{ $option }}">{{ $option }}</option>
                @endforeach
            </select>
        @else
            <input
                id="{{ $id }}"
                name="{{ $name }}"
                type="{{ $type }}"
                placeholder="{{ $tx($placeholder) }}"
                @if ($autocomplete) autocomplete="{{ $autocomplete }}" @endif
                required
            >
        @endif
    </div>
</div>
