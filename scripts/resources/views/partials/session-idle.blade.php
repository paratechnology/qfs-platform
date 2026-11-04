@php
    $idleMinutes = max(0, (int) config('qfs.session_idle_minutes', 30));
@endphp
@if ($idleMinutes > 0)
<script>
window.__QFS_SESSION_IDLE_MS = @json($idleMinutes * 60 * 1000);
window.__QFS_SESSION_LOGIN = @json($sessionLoginPath ?? '/user/user/login');
</script>
<script defer src="/js/session-idle.js"></script>
@endif
