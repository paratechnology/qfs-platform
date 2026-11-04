@php
    $txIco = ['dep' => 'arrow-down', 'inv' => 'trending-up', 'wd' => 'arrow-up', 'earn' => 'wallet', 'ref' => 'wallet', 'swap' => 'swap-vert'];
@endphp
<div class="dash-tx-item">
    <span class="dash-tx-ico {{ $t['kind'] }}"><x-dash-icon :name="$txIco[$t['kind']] ?? 'wallet'" /></span>
    <div class="dash-tx-meta">
        <b>{{ $t['title'] }}</b>
        <span>{{ $t['meta'] }}</span>
        <span>{{ $t['date'] }}</span>
    </div>
    <div class="dash-tx-amount">
        <b class="{{ $t['cls'] }} num">{{ $t['amount'] }}</b>
        <span class="dash-tx-status">{{ $t['status'] }}</span>
    </div>
</div>
