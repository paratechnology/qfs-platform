@php $items = $overview['accrual']['items'] ?? []; @endphp
<div x-data="investmentUpdates(@js($items))">
    <div class="dash-load-error" x-show="error" x-cloak role="alert"><span x-text="error"></span><button class="dash-btn ghost" @click="refresh()">{{ $tx('Retry') }}</button></div>
    <p class="dash-input-note" x-show="changed" x-cloak>{{ $tx('Your investment status has changed.') }} <a href="/user/user/dashboard/investments">{{ $tx('Refresh investment details') }}</a></p>
    @if (empty($items))
        <div class="dash-investment-empty"><p>{{ $tx('You have no active investments.') }}</p><p class="dash-input-note">{{ $tx('Invest directly from your available USD or crypto balance. Principal and returns are fixed in USD.') }}</p><button type="button" class="dash-btn primary" @click="openModal('invest')">{{ $tx('Start New Investment') }}</button></div>
    @else
        <div class="dash-portfolio">@foreach ($items as $item) @include('dashboard.partials.investment-position', ['item' => $item]) @endforeach</div>
    @endif
    <h2 class="dash-section-title">{{ $tx('Completed investments') }}</h2>
    <div class="dash-portfolio">@forelse ($investmentHistory['items'] ?? [] as $item) @include('dashboard.partials.investment-position', ['item' => $item]) @empty<p class="dash-input-note">{{ $tx('No completed investment terms yet.') }}</p>@endforelse</div>
    <nav class="dash-actions-row" aria-label="{{ $tx('Investment history') }}">
        @if (request('cursor'))<a class="dash-btn ghost" href="/user/user/dashboard/investments">{{ $tx('Latest completed investments') }}</a>@endif
        @if (!empty($investmentHistory['nextCursor']))<a class="dash-btn ghost" href="{{ '/user/user/dashboard/investments?'.http_build_query(['cursor' => $investmentHistory['nextCursor']]) }}">{{ $tx('Next completed investments') }}</a>@endif
    </nav>
</div>
