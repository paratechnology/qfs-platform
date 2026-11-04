{{-- One balance card. $b = BalanceCard, $ico = dash-icon name. Inside the dashboard() Alpine scope. --}}
<div class="dash-balance-card {{ $b['key'] === 'balance' ? 'primary' : '' }}{{ $b['key'] === 'loans' ? ' loans' : '' }}">
    <div class="dash-balance-top">
        <span class="dash-balance-ico"><x-dash-icon :name="$ico" /></span>
    </div>
    <span class="dash-balance-label">{{ $b['label'] }}</span>
    <div class="dash-balance-amount">{{ $b['amount'] }}</div>
    <div class="dash-balance-sub">
        <span class="{{ ($b['trendDir'] ?? '') === 'up' ? 'up' : (($b['trendDir'] ?? '') === 'down' ? 'down' : '') }}">{{ $b['trend'] ?? '' }}</span>
    </div>
    <button class="dash-balance-action {{ ($b['tone'] ?? '') === 'lime' ? 'lime' : (($b['tone'] ?? '') === 'danger' ? 'danger' : 'ghost') }}"
        @click="openModal(@js($b['actionModal'] ?? ''))">{{ $b['action'] ?? '' }}</button>
</div>
