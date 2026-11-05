{{-- Loading / error / empty states for an admList component. $loadingLabel optional. --}}
<template x-if="toast"><div class="adm-banner" role="status" style="margin-bottom:12px"><span x-text="toast"></span></div></template>
<template x-if="error"><div class="adm-banner error" role="alert"><span x-text="error"></span> <button class="adm-btn ghost sm" @click="load()">{{ $tx('Retry') }}</button></div></template>
<template x-if="loading && !rows.length"><div class="adm-loading" role="status"><span class="adm-spinner" aria-hidden="true"></span> {{ $loadingLabel ?? 'Loading…' }}</div></template>
<template x-if="!loading && !error && rows.length === 0"><div class="adm-empty"><b>{{ $tx('Nothing here yet') }}</b></div></template>
