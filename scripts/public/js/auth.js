/*
 * Auth form behaviour for the Blade pages.
 * Posts to the existing Laravel JSON API (/api/auth/*). The API sets the
 * httpOnly qfs_session cookie on success, so we just redirect afterwards.
 * Registered as Alpine components; no build step.
 */
function persistReferralFromUrl() {
  try {
    const ref = new URLSearchParams(location.search).get("ref");
    if (ref && ref.trim()) {
      sessionStorage.setItem("qfs_referral_code", ref.trim());
    }
  } catch (_) {
    /* storage / URL optional */
  }
}

document.addEventListener("alpine:init", () => {
  // Sign in / register (also handles the two-factor challenge step).
  Alpine.data("signInForm", (opts = {}) => ({
    endpoint: opts.endpoint || "/api/auth/login",
    mode: opts.mode || "login", // "login" | "register"
    redirect: opts.redirect || "/user/user/dashboard",
    requireAdmin: !!opts.requireAdmin,
    busy: false,
    error: "",
    challenge: "",
    registered: false,
    signedIn: false,

    init() {
      if (this.mode === "register") {
        persistReferralFromUrl();
      }
    },

    async submit(event) {
      if (this.busy) return;
      this.error = "";
      const form = event.target;
      const data = Object.fromEntries(new FormData(form).entries());

      if (this.mode === "register") {
        try {
          const ref =
            new URLSearchParams(location.search).get("ref") ||
            sessionStorage.getItem("qfs_referral_code");
          if (ref) data.referralCode = ref;
        } catch (_) {
          /* storage is optional */
        }
      }

      if (data.password && data.confirmPassword && data.password !== data.confirmPassword) {
        this.error = "Passwords do not match";
        return;
      }

      this.busy = true;
      let redirecting = false;
      try {
        const url = this.challenge ? "/api/auth/two-factor" : this.endpoint;
        const body = this.challenge ? { challenge: this.challenge, code: data.code } : data;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);

        if (!res.ok || !json || !json.ok) {
          this.error = (json && json.error && json.error.message) || "Something went wrong. Please try again.";
          return;
        }

        if (json.data && json.data.twoFactorRequired) {
          this.challenge = json.data.challenge;
          form.reset();
          return;
        }

        if (this.mode === "register") {
          try {
            sessionStorage.removeItem("qfs_referral_code");
          } catch (_) {
            /* registration already succeeded */
          }
          form.reset();
          this.registered = true;
          return;
        }

        const role = json.data && json.data.user && json.data.user.role;
        if (this.requireAdmin && role !== "ADMIN") {
          try {
            await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" } });
          } catch (_) {
            /* best effort */
          }
          this.error = "This account does not have administrator access.";
          return;
        }

        redirecting = true;
        this.signedIn = true;
        location.assign(role === "ADMIN" ? "/admin" : this.redirect);
      } catch (_) {
        this.error = "Network error. Please try again.";
      } finally {
        if (!redirecting) this.busy = false;
      }
    },
  }));

  // Forgot-password (request link) and reset-password (set new password).
  Alpine.data("recoveryForm", (opts = {}) => ({
    reset: !!opts.reset,
    token: null,
    ready: false,
    busy: false,
    error: "",
    success: false,

    init() {
      const read = () => {
        if (this.reset) {
          const value = new URLSearchParams(location.hash.slice(1)).get("token");
          this.token = value && /^[a-f0-9]{64}$/.test(value) ? value : null;
          this.error = "";
          this.success = false;
        }
        this.ready = true;
      };
      read();
      window.addEventListener("hashchange", read);
    },

    async submit(event) {
      if (this.busy || (this.reset && !this.token)) return;
      const form = event.target;
      const body = Object.fromEntries(new FormData(form).entries());
      if (this.reset && body.password !== body.confirmPassword) {
        this.error = "Passwords do not match.";
        return;
      }
      if (this.reset) body.token = this.token;

      this.busy = true;
      this.error = "";
      try {
        const res = await fetch(this.reset ? "/api/auth/reset-password" : "/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || !json.ok) {
          throw new Error((json && json.error && json.error.message) || "Could not complete this request. Please try again.");
        }
        if (this.reset) {
          form.reset();
          history.replaceState(null, "", location.pathname);
          this.token = null;
        }
        this.success = true;
      } catch (err) {
        this.error = err.message === "Failed to fetch" ? "Connection lost. Please try again." : err.message;
      } finally {
        this.busy = false;
      }
    },
  }));
});
