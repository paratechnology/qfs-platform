/*
 * Signs the user out in the browser after idle time and when returning to a
 * backgrounded tab, matching server-side SessionAuth idle expiry.
 */
(function () {
  const idleMs = Number(window.__QFS_SESSION_IDLE_MS);
  const loginPath = window.__QFS_SESSION_LOGIN || "/user/user/login";
  if (!idleMs || idleMs < 60_000) {
    return;
  }

  let lastActivity = Date.now();
  let checking = false;

  const bump = () => {
    lastActivity = Date.now();
  };

  ["mousedown", "keydown", "touchstart", "scroll"].forEach((eventName) => {
    document.addEventListener(eventName, bump, { passive: true, capture: true });
  });

  function redirectToLogin() {
    const url = new URL(loginPath, location.origin);
    url.searchParams.set("reason", "session-expired");
    location.replace(url.toString());
  }

  async function verifyWithServer() {
    if (checking) {
      return false;
    }
    checking = true;
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
      if (res.status === 401) {
        redirectToLogin();
        return false;
      }
      return res.ok;
    } catch (_) {
      return true;
    } finally {
      checking = false;
    }
  }

  async function handleIdleDeadline() {
    if (Date.now() - lastActivity < idleMs) {
      return;
    }
    const ok = await verifyWithServer();
    if (!ok) {
      return;
    }
    if (Date.now() - lastActivity >= idleMs) {
      redirectToLogin();
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      return;
    }
    if (Date.now() - lastActivity >= idleMs) {
      void verifyWithServer();
    }
  });

  window.setInterval(() => {
    void handleIdleDeadline();
  }, 60_000);
})();
