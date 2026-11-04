@php
    $status = $item['status'] ?? 'ACTIVE';
    $date = fn ($value) => $value ? \Carbon\CarbonImmutable::parse($value)->utc()->locale(app()->getLocale())->translatedFormat('j M Y, H:i').' UTC' : $tx('Not scheduled');
    $terminal = in_array($status, ['MATURED', 'CLOSED'], true);
@endphp
<details class="dash-position" data-investment-id="{{ $item['id'] }}">
    <summary>
        <div class="dash-position-main"><div class="dash-position-title">
            <span class="dash-page-eyebrow">{{ $status === 'MATURED' ? $tx('Term completed · awaiting principal release') : ($status === 'CLOSED' ? $tx(!empty($item['principalReturnedAt']) ? 'Completed · principal returned' : 'Closed investment') : $tx('Active investment')) }}</span>
            <strong>{{ $item['plan'] }}</strong><span>{{ $item['monthlyRate'] }} {{ $tx('monthly') }} · {{ $item['termMonths'] ?? '' }} {{ $tx('months') }} · {{ $tx('Profit paid') }} {{ $tx(($item['payoutInterval'] ?? '') === 'HOURLY' ? 'hourly' : 'monthly') }}</span>
        </div><div class="dash-position-principal"><span>{{ $tx('Principal') }}</span><strong>{{ $item['principal'] }}</strong></div>
        <span class="dash-position-toggle"><span>{{ $tx('Details') }}</span><x-dash-icon name="chevron-down" :size="18" /></span></div>
        <div class="dash-position-overview">
            <div><span>{{ $tx('Monthly profit') }}</span><strong>{{ $item['monthlyProfit'] }}</strong></div>
            <div><span>{{ $tx('Pending payout') }}</span><strong x-text="positionValue(@js($item['id']), 'pending', @js($item['pending']))">{{ $item['pending'] }}</strong></div>
            <div><span>{{ $tx('Paid to balance') }}</span><strong x-text="positionValue(@js($item['id']), 'paid', @js($item['paid']))">{{ $item['paid'] }}</strong></div>
            <div><span>{{ $tx($terminal ? 'Principal status' : 'Next profit payout') }}</span><strong>{{ !empty($item['principalReturnedAt']) ? $tx('Returned {value0}', ['value0' => $date($item['principalReturnedAt'])]) : ($status === 'MATURED' ? $tx('Awaiting admin release') : ($status === 'CLOSED' ? $tx('Closed') : $date($item['nextPayoutAt'] ?? null))) }}</strong></div>
        </div>
        <div class="dash-position-progress"><div><span>{{ $tx('Started {value0}', ['value0' => $date($item['startedAt'])]) }}</span><span>{{ $tx('Term ends {value0}', ['value0' => $date($item['endsAt'] ?? null)]) }}</span></div><progress aria-label="{{ $tx('Term progress') }}" max="100" :value="positionValue(@js($item['id']), 'progressPercent', @js($item['progressPercent'] ?? 0))" value="{{ $item['progressPercent'] ?? 0 }}"></progress></div>
    </summary>
    <div class="dash-position-detail">
        @if (!empty($item['description']))<p lang="{{ $item['contentLanguage'] ?? 'en' }}" dir="auto">{{ $item['description'] }}</p>@endif
        <h3>{{ $tx('Investment terms') }}</h3>
        @if (!empty($item['funding']))
            <p class="dash-input-note">{{ $tx('Funded with {quantity} {asset} at {rate} USD per coin. Principal and returns are fixed in USD.', ['quantity' => $item['funding']['quantity'], 'asset' => $item['funding']['symbol'] ?? $item['funding']['assetKey'], 'rate' => $item['funding']['rateUsd']]) }} · {{ $item['funding']['network'] ?? '' }}</p>
        @endif
        <dl class="dash-investment-terms">
            <div><dt>{{ $tx('Investment reference') }}</dt><dd>{{ $item['id'] }}</dd></div>
            <div><dt>{{ $tx('Monthly return') }}</dt><dd>{{ $tx('{value0} on original principal', ['value0' => $item['monthlyRate']]) }}</dd></div>
            <div><dt>{{ $tx('Duration') }}</dt><dd>{{ $item['termMonths'] ?? '' }} {{ $tx('months') }}</dd></div>
            <div><dt>{{ $tx('Profit payout') }}</dt><dd>{{ $tx(($item['payoutInterval'] ?? '') === 'HOURLY' ? 'Credited to available balance hourly' : 'Accrued hourly; credited on each monthly anniversary') }}</dd></div>
            <div><dt>{{ $tx('Scheduled profit over term') }}</dt><dd>{{ $item['totalExpectedProfit'] ?? $tx('Not available') }}</dd></div>
        </dl>
        <p class="dash-input-note">{{ $tx('Profit is based on the original principal and does not compound automatically. Monthly periods follow the start date; accrual advances in full hours.') }}</p>
        @if (!empty($item['principalRelease']))<p class="dash-input-note">{{ $tx('Principal release: {value0}. Early exit is not available.', ['value0' => $tx($item['principalRelease'] === 'AUTOMATIC' ? 'returned to available balance automatically after the term and final profit settlement' : 'released by an admin after the term and final profit settlement')]) }}</p>@endif
        @if (!empty($item['terms']))<div class="dash-position-prose"><h3>{{ $tx('Additional plan terms') }}</h3><p lang="{{ $item['contentLanguage'] ?? 'en' }}" dir="auto">{{ $item['terms'] }}</p></div>@else<p class="dash-input-note">{{ $tx('Additional terms have not been published for this investment.') }}</p>@endif
        @if (!empty($item['riskDisclosure']))<div class="dash-position-prose"><h3>{{ $tx('Risk disclosure') }}</h3><p lang="{{ $item['contentLanguage'] ?? 'en' }}" dir="auto">{{ $item['riskDisclosure'] }}</p></div>@endif
        @if (!empty($item['originalMaterials']))<details class="dash-position-prose" lang="en" dir="ltr"><summary>{{ $tx('View original English materials') }}</summary>@foreach (['description', 'terms', 'riskDisclosure'] as $field)@if (!empty($item['originalMaterials'][$field]))<p>{{ $item['originalMaterials'][$field] }}</p>@endif @endforeach</details>@endif
        <h3>{{ $tx('Supporting documents') }}</h3>
        @forelse ($item['documents'] ?? [] as $document)
            <p><a class="dash-btn ghost" href="{{ $document['fileUrl'] }}" target="_blank" rel="noreferrer"><x-dash-icon name="file-pdf" :size="16" />{{ $document['title'] }} · {{ $tx('Open document ↗') }}</a></p>
        @empty<p class="dash-input-note">{{ $tx('No supporting documents are attached.') }}</p>@endforelse
        @if (!empty($item['materialsCapturedAt']))<p class="dash-input-note">{{ $tx(($item['materialsSource'] ?? '') === 'CURRENT_PLAN' ? 'Supporting materials reflect the current plan publication' : 'Supporting materials recorded when this investment began') }} · {{ $date($item['materialsCapturedAt']) }}. {{ $tx('Financial terms remain those recorded when the investment started.') }}</p>@endif
    </div>
</details>
