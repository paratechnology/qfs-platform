/*
 * Account dashboard behaviour (Blade). The shell + overview are server-rendered;
 * this drives the chrome: sidebar, theme, account menu, modals, search, logout.
 * Plain Alpine components, no build step.
 */
const MODAL_SOURCES = {
  deposit: "Add Funds",
  withdraw: "Make New withdrawal",
  swap: "Swap crypto",
  cards: "Manage Cards",
  invest: "Start New Investment",
  loanApply: "Loan Application",
  notifications: "Notifications",
  profile: "My Profile",
};

function modalLabel(key) {
  const source = MODAL_SOURCES[key];
  if (!source) return (window.__QFS_TX && window.__QFS_TX("Dialog")) || "Dialog";
  return (window.__QFS_TX && window.__QFS_TX(source)) || source;
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function referralLinkForViewer(canonicalUrl, code) {
  const trimmed = String(code || "").trim();
  if (!trimmed) {
    return canonicalUrl || "";
  }
  const local = `${location.origin}/register?ref=${encodeURIComponent(trimmed)}`;
  if (!canonicalUrl) {
    return local;
  }
  try {
    const canonical = new URL(canonicalUrl);
    if (!isLocalHost(location.hostname) && isLocalHost(canonical.hostname)) {
      return local;
    }
    return canonicalUrl;
  } catch (_) {
    return local;
  }
}

document.addEventListener("alpine:init", () => {
  Alpine.data("referralLink", (initial = {}) => ({
    copied: false,
    link: "",

    init() {
      this.link = referralLinkForViewer(initial.url || "", initial.code || "");
    },
  }));

  Alpine.data("dashboard", (initial = {}) => ({
    sidebarOpen: false,
    menuOpen: false,
    modal: null,
    busy: false,
    theme: "light",
    toast: "",
    portfolioAvailable: null,
    notifUnread: initial.unread ?? 0,
    notifItems: Array.isArray(initial.items) ? initial.items : [],

    init() {
      this._fundsUpdated = event => { this.portfolioAvailable = event.detail.valuationComplete ? event.detail.availableUsd : "—"; };
      this._fundsRefresh = () => { if (!document.querySelector('[x-data="cryptoFundsPanel()"]')) this.refreshFunds(); };
      window.addEventListener("dash-funds-updated", this._fundsUpdated);
      window.addEventListener("dash-funds-refresh", this._fundsRefresh);
      this._fundsRefresh();
      try {
        this.theme = localStorage.getItem("qfs_dash_theme") || "light";
      } catch (_) {
        /* storage optional */
      }
    },

    async refreshFunds() {
      try { this.portfolioAvailable = (await fundingRequest("/api/wallet/funds")).availableUsd ?? "—"; }
      catch (_) { this.portfolioAvailable = "—"; }
    },
    destroy() {
      window.removeEventListener("dash-funds-updated", this._fundsUpdated);
      window.removeEventListener("dash-funds-refresh", this._fundsRefresh);
      if (document.body && this.modal) document.body.style.overflow = this._bodyOverflow || "";
    },
    toggleTheme() {
      this.theme = this.theme === "light" ? "dark" : "light";
      try {
        localStorage.setItem("qfs_dash_theme", this.theme);
      } catch (_) {
        /* storage optional */
      }
    },

    get modalTitle() {
      return modalLabel(this.modal);
    },

    openModal(name) {
      const detail = typeof name === "object" ? name : {};
      name = detail.name || name;
      if (!name) return;
      const routes = {
        investments: "/user/user/dashboard/investments",
        history: "/user/user/dashboard/transactions",
        withdrawalHistory: "/user/user/dashboard/withdrawals",
        loans: "/user/user/dashboard/loans",
      };
      if (routes[name]) {
        location.assign(routes[name]);
        return;
      }
      this.menuOpen = false;
      this.sidebarOpen = false;
      if (document.body && !this.modal) {
        this._bodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      }
      this.modal = name;
      if (name === "notifications") this.loadNotifications();
      if (name === "deposit") {
        queueMicrotask(() => window.dispatchEvent(new CustomEvent("dash-deposit-open")));
      }
      if (name === "withdraw") {
        queueMicrotask(() => window.dispatchEvent(new CustomEvent("dash-withdraw-open", { detail })));
      }
      if (name === "invest") {
        queueMicrotask(() => window.dispatchEvent(new CustomEvent("dash-invest-open", { detail })));
      }
    },

    closeModal() {
      this.modal = null;
      if (document.body) document.body.style.overflow = this._bodyOverflow || "";
    },

    showToast(message) {
      this.toast = message || "";
      if (!this.toast) return;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        this.toast = "";
      }, 2800);
    },

    async loadNotifications() {
      try {
        const response = await fetch("/api/notifications", { cache: "no-store" }); const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error?.message || "Could not load notifications.");
        this.notifItems = json.data.items.map(item => ({ ...item, time: new Date(item.createdAt).toLocaleString() })); this.notifUnread = json.data.unread;
      } catch (error) { this.showToast(error.message); }
    },
    async readNotification(item) {
      if (this.busy || item.read) return;
      this.busy = true;
      try {
        const response = await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }) });
        const json = await response.json(); if (!response.ok || !json.ok) throw new Error(json.error?.message || "Could not update notification.");
        item.read = true; this.notifUnread = Math.max(0, this.notifUnread - 1);
      } catch (error) { this.showToast(error.message); } finally { this.busy = false; }
    },

    async markAllNotificationsRead() {
      if (this.busy || this.notifUnread === 0) return;
      this.busy = true;
      try {
        const res = await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || !json.ok) {
          throw new Error((json && json.error && json.error.message) || "Something went wrong. Please try again.");
        }
        this.notifItems = this.notifItems.map((item) => ({ ...item, read: true }));
        this.notifUnread = 0;
        this.showToast((window.__QFS_TX && window.__QFS_TX("All notifications marked as read")) || "All notifications marked as read");
      } catch (error) {
        this.showToast(error.message || "Something went wrong. Please try again.");
      } finally {
        this.busy = false;
      }
    },

    async logout() {
      if (this.busy) return;
      this.busy = true;
      try {
        await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" } });
      } catch (_) {
        /* best effort */
      }
      location.assign("/user/user/login");
    },
  }));

  // Topbar search -> /api/search.
  Alpine.data("dashSearch", () => ({
    q: "",
    open: false,
    loading: false,
    items: [],

    async run() {
      const term = this.q.trim();
      if (term.length < 2) {
        this.items = [];
        return;
      }
      this.loading = true;
      this.open = true;
      try {
        const res = await fetch("/api/search?q=" + encodeURIComponent(term), { headers: { Accept: "application/json" } });
        const json = await res.json().catch(() => null);
        const results = (json && json.ok && (json.data.items || json.data.results || json.data)) || [];
        this.items = (Array.isArray(results) ? results : []).map((it) => ({
          kind: it.kind || "",
          title: it.title || "",
          subtitle: it.subtitle || "",
          href: this.hrefFor(it),
        }));
      } catch (_) {
        this.items = [];
      } finally {
        this.loading = false;
      }
    },

    hrefFor(it) {
      const m = it.actionModal || "";
      if (m.startsWith("market:")) return "/user/user/dashboard#dashboard-markets";
      if (m === "transaction") return "/user/user/dashboard/transactions?id=" + encodeURIComponent(it.targetId || "");
      if (m === "invest") return "/user/user/dashboard/investments?plan=" + encodeURIComponent(it.targetId || "");
      return "/user/user/dashboard";
    },
  }));
});
