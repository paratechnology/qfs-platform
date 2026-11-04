/*
 * Dashboard sub-view data loaders (transactions, withdrawals, loans,
 * statements). Each fetches the existing JSON API and renders client-side.
 */
const TX_KIND = { DEPOSIT: "dep", WITHDRAWAL: "wd", INVESTMENT: "inv", REFERRAL_BONUS: "ref", SWAP: "swap" };
const TX_ICON = { dep: "arrow-down", inv: "trending-up", wd: "arrow-up", earn: "wallet", ref: "wallet", swap: "swap-vert" };
const STMT_LABEL = {
  DEPOSIT: "Deposit", WITHDRAWAL: "Withdrawal", INVESTMENT: "Investment", EARNING: "Earning",
  REFERRAL_BONUS: "Referral Bonus", LOAN: "Loan", ADJUSTMENT: "Adjustment", PRINCIPAL_RETURN: "Principal return",
  SWAP: "Crypto swap", PENDING: "Pending", COMPLETED: "Completed", CANCELLED: "Cancelled", FAILED: "Failed",
};

const money = (cents) => "$" + (Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cap = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : "");

// Icon bodies needed for client-rendered rows (mirrors dash-icon.blade.php).
const ICON_BODY = {
  "arrow-down": '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  "arrow-up": '<path d="M12 19V5M5 12l7-7 7 7"/>',
  "trending-up": '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  "wallet": '<path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z"/><path d="M3 9h15"/>',
  "swap-vert": '<path d="M7 3v18M4 6l3-3 3 3M17 21V3M14 18l3 3 3-3"/>',
};
const strokeIcon = (name, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_BODY[name] || ""}</svg>`;

document.addEventListener("alpine:init", () => {
  // Transactions + withdrawals share one item shape.
  Alpine.data("txList", (endpoint) => ({
    endpoint,
    items: [],
    cursor: null,
    loading: true,
    loadingMore: false,
    error: "",

    async init() {
      if (this.endpoint === "/api/transactions") {
        const id = new URLSearchParams(window.location.search).get("id");
        if (id) this.endpoint += "?id=" + encodeURIComponent(id);
      }
      await this.load();
    },

    icon(kind) {
      return TX_ICON[kind] || "wallet";
    },

    iconSvg(kind) {
      return strokeIcon(this.icon(kind));
    },

    map(item) {
      const kind = TX_KIND[item.type] || "earn";
      const outgoing = item.type === "WITHDRAWAL" || item.type === "INVESTMENT";
      const sign = item.type === "SWAP" ? "" : outgoing ? "-" : "+";
      return {
        id: item.id,
        kind,
        title: item.label,
        meta: item.note || item.method || item.reference,
        amount: sign + item.amount,
        cls: item.type === "SWAP" ? "neutral" : outgoing ? "minus" : "plus",
        date: new Date(item.createdAt).toLocaleString(),
        status: cap(item.status),
      };
    },

    async load() {
      this.loading = true;
      this.error = "";
      try {
        const res = await fetch(this.endpoint, { headers: { Accept: "application/json" }, cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || !json.ok) throw new Error((json && json.error && json.error.message) || "Could not load.");
        this.items = (json.data.items || []).map((i) => this.map(i));
        this.cursor = json.data.nextCursor || null;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    async more() {
      if (!this.cursor || this.loadingMore) return;
      this.loadingMore = true;
      try {
        const sep = this.endpoint.includes("?") ? "&" : "?";
        const res = await fetch(this.endpoint + sep + "cursor=" + encodeURIComponent(this.cursor), { headers: { Accept: "application/json" } });
        const json = await res.json().catch(() => null);
        if (json && json.ok) {
          this.items.push(...(json.data.items || []).map((i) => this.map(i)));
          this.cursor = json.data.nextCursor || null;
        }
      } finally {
        this.loadingMore = false;
      }
    },
  }));

  // Loans.
  Alpine.data("loanList", () => ({
    items: [],
    loading: true,
    error: "",

    async init() {
      try {
        const res = await fetch("/api/loans", { headers: { Accept: "application/json" }, cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || !json.ok) throw new Error((json && json.error && json.error.message) || "Could not load loans.");
        this.items = Array.isArray(json.data) ? json.data : json.data.items || [];
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    money,
    cap,
    date(d) {
      return d ? new Date(d).toLocaleDateString() : "—";
    },
  }));

  // Account statements.
  Alpine.data("statements", () => ({
    from: "",
    to: "",
    data: null,
    busy: false,
    error: "",

    async init() {
      await this.load();
    },

    async load(event) {
      if (event) event.preventDefault();
      this.busy = true;
      this.error = "";
      try {
        const q = new URLSearchParams({ ...(this.from ? { from: this.from } : {}), ...(this.to ? { to: this.to } : {}) });
        const res = await fetch("/api/account/statement?" + q, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || !json.ok) throw new Error((json && json.error && json.error.message) || "Could not load your statement.");
        this.data = json.data;
        this.from = json.data.from;
        this.to = json.data.to;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },

    get path() {
      return this.data ? "/api/account/statement?" + new URLSearchParams({ from: this.data.from, to: this.data.to }) : "";
    },

    money,
    label(t) {
      return STMT_LABEL[t] || t;
    },
    date(d) {
      return d ? new Date(d).toLocaleString() : "";
    },
  }));
});

// Preserve the server-rendered investment detail/document view while updating accrual values.
document.addEventListener("alpine:init", () => {
  Alpine.data("investmentUpdates", (initial = []) => ({
    positions: Object.fromEntries(initial.map(item => [item.id, item])), initialIds: initial.map(item => item.id).sort().join(","),
    timer: null, error: "", changed: false,
    init() { this.timer = setInterval(() => { if (!document.hidden) this.refresh(); }, 60000); },
    destroy() { clearInterval(this.timer); },
    positionValue(id, field, fallback) { return this.positions[id]?.[field] ?? fallback; },
    async refresh() {
      try {
        const data = await apiRequest("/api/dashboard/overview");
        const rows = data.accrual?.items || [];
        this.positions = Object.fromEntries(rows.map(item => [item.id, item]));
        this.changed = rows.map(item => item.id).sort().join(",") !== this.initialIds;
        this.error = "";
        window.dispatchEvent(new CustomEvent("dash-funds-refresh"));
      } catch (error) { this.error = error.message; }
    },
  }));
});
