<div class="adm-pagination" x-show="totalPages > 1 || total > 0">
    <span class="adm-pagination-total"><span x-text="total"></span> rows · page <span x-text="page"></span> of <span x-text="Math.max(totalPages, 1)"></span></span>
    <div class="adm-pagination-btns">
        <button class="adm-btn ghost sm" :disabled="page <= 1" @click="go(page - 1)">{{ $tx('← Prev') }}</button>
        <button class="adm-btn ghost sm" :disabled="page >= totalPages" @click="go(page + 1)">{{ $tx('Next →') }}</button>
    </div>
</div>
