@php
    $reviewItems = $overview['reviews'] ?? [];
    $illustrative = (bool) ($overview['illustrativeReviews'] ?? false);
@endphp
@if ($illustrative || count($reviewItems) > 0)
<section class="dash-review-reel" aria-label="{{ $tx('Customer voices') }}"
    x-data="reviewReel(@js($reviewItems))"
    x-init="illustrative = @js($illustrative)"
    @pointerenter="if ($event.pointerType === 'mouse') hovered = true"
    @pointerleave="hovered = false"
    @focusin.capture="focused = true"
    @focusout.capture="if (!$root.contains($event.relatedTarget)) focused = false">
    <header class="dash-reel-header">
        <div class="dash-reel-heading">
            <span class="dash-reel-eyebrow">{{ $tx('Customer voices') }}</span>
            <span class="dash-reel-caption">{{ $tx($illustrative ? 'Illustrative reviews' : 'From our community') }}</span>
        </div>
        <template x-if="items.length > 1 && !reducedMotion">
            <div class="dash-reel-controls">
                <button type="button" class="dash-reel-control" @click="toggle()" :aria-label="paused ? @js($tx('Play reviews')) : @js($tx('Pause reviews'))" :aria-pressed="paused">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path x-show="paused" d="M4 2.5v11L13 8Z" />
                        <path x-show="!paused" d="M4 3h3v10H4zm5 0h3v10H9z" />
                    </svg>
                </button>
            </div>
        </template>
    </header>
    <template x-if="!current">
        <section class="dash-review-invite">
            <div><strong>{{ $tx('Share your experience') }}</strong><span>{{ $tx('Your review appears here after approval.') }}</span></div>
        </section>
    </template>
    <template x-if="current">
        <div class="dash-reel-stage" :class="{ cinematic }">
            <article class="dash-reel-slide">
                <blockquote dir="auto" x-text="current.text"></blockquote>
                <div class="dash-reel-author">
                    <template x-if="current.avatar || current.image">
                        <img class="dash-reel-avatar dash-reel-avatar-photo" :src="current.image || current.avatar" alt="">
                    </template>
                    <template x-if="!(current.avatar || current.image)">
                        <span class="dash-reel-avatar" aria-hidden="true" x-text="(current.name || '?').trim().charAt(0)"></span>
                    </template>
                    <div><b dir="auto" x-text="current.name"></b>
                        <span class="dash-reel-stars" aria-hidden="true">
                            <template x-for="i in Math.min(5, Math.max(0, current.stars || 0))" :key="i"><x-dash-icon name="star" :size="11" /></template>
                        </span>
                    </div>
                </div>
            </article>
        </div>
        <footer class="dash-reel-footer">
            <template x-if="items.length > 1">
                <nav class="dash-reel-navigation" aria-label="{{ $tx('Review navigation') }}">
                    <button type="button" class="dash-reel-control previous" @click="move(-1)"><x-dash-icon name="chevron-right" :size="16" /></button>
                    <span class="dash-reel-count"><span x-text="position + 1"></span> <span>/</span> <span x-text="items.length"></span></span>
                    <button type="button" class="dash-reel-control next" @click="move(1)"><x-dash-icon name="chevron-right" :size="16" /></button>
                </nav>
            </template>
        </footer>
        <div class="dash-reel-progress" x-show="playing"><span :style="`animation-duration: ${duration}ms`"></span></div>
    </template>
</section>
@endif
