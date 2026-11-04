@php
    $reviews = $overview['reviews'] ?? [];
    $ratings = $overview['reviewRatings'] ?? ['total' => 0, 'average' => 0, 'scorePercent' => 0, 'stars' => []];
    $illustrative = (bool) ($overview['illustrativeReviews'] ?? false);
@endphp
<div class="dash-reviews-panel" x-data="reviewRatings(@js($ratings))" x-effect="tab === 'reviews' ? play() : reset()">
    <div class="dash-actions-row"><button type="button" class="dash-btn ghost" @click="openModal('reviewList')">{{ $tx('View all reviews') }}</button><button type="button" class="dash-btn primary" @click="openModal('reviewForm')">{{ $tx('Write a review') }}</button></div>
    <div class="dash-review-head">
        <div>
            <b>{{ $tx('Customers Reviews') }}</b>
            <p class="dash-review-score" x-show="total > 0">
                <strong x-text="average.toFixed(2)"></strong>
                <span>{{ $tx('average') }} · <span x-text="scoreShown.toFixed(1)"></span>%</span>
            </p>
        </div>
        <span class="dash-review-badge"><span x-text="total"></span> · {{ $tx('Reviews') }}</span>
    </div>
    @if ($illustrative)
        <p class="dash-input-note">{{ $tx('Illustrative reviews') }}</p>
    @endif

    <div class="dash-rating-list" x-show="total > 0">
        <template x-for="row in stars" :key="row.stars">
            <div class="dash-rating-row">
                <span class="dash-rating-label"><span x-text="row.stars"></span> <x-dash-icon name="star" :size="13" /></span>
                <div class="dash-rating-track" role="meter" :aria-valuenow="row.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="row.stars + ' star share'">
                    <div class="dash-rating-fill" :style="`width: ${shown[row.stars] || 0}%`"></div>
                </div>
                <span class="dash-rating-pct"><span x-text="shown[row.stars] || 0"></span>%</span>
            </div>
        </template>
    </div>

    @forelse (array_slice($reviews, 0, 6) as $r)
        <div class="dash-review-card">
            <div class="dash-review-card-head">
                @if (! empty($r['image'] ?? $r['avatar'] ?? null))
                    <img src="{{ $r['image'] ?? $r['avatar'] }}" alt="">
                @else
                    <span class="dash-reel-avatar" aria-hidden="true">{{ mb_substr($r['name'], 0, 1) }}</span>
                @endif
                <div style="min-width:0">
                    <b>{{ $r['name'] }}</b>
                    @if (! empty($r['meta']))<span>{{ $r['meta'] }}</span>@endif
                </div>
                <span class="dash-review-stars">
                    @for ($i = 0; $i < ($r['stars'] ?? 0); $i++)
                        <x-dash-icon name="star" :size="14" />
                    @endfor
                </span>
            </div>
            <p>{{ $r['text'] ?? '' }}</p>
        </div>
    @empty
        <p class="dash-input-note">{{ $tx('No approved reviews yet.') }}</p>
    @endforelse
</div>
