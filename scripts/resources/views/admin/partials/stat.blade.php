<div class="adm-stat">
    <div class="adm-stat-top">
        <span class="adm-stat-label">{{ $label }}</span>
        <span class="adm-stat-ico"><x-dash-icon :name="$ico" /></span>
    </div>
    <div class="adm-stat-value">{{ $value }}</div>
    @isset($sub)<div class="adm-stat-sub">{{ $sub }}</div>@endisset
</div>
