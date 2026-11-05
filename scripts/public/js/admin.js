/*
 * Admin console behaviour (Blade). Shell chrome + shared data loaders for the
 * list/content pages. Calls /api/admin/* (401 -> admin login). No build step.
 */
async function admGet(path) {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !json.ok) {
    if (res.status === 401) {
      location.href = "/admin/login";
      throw new Error("Session expired");
    }
    throw new Error((json && json.error && json.error.message) || "Request failed");
  }
  return json.data;
}

async function admSend(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !json.ok) {
    if (res.status === 401) {
      location.href = "/admin/login";
      throw new Error("Session expired");
    }
    throw new Error((json && json.error && json.error.message) || "Request failed");
  }
  return json.data;
}

const admMoney = (cents) => {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const admDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const admCap = (s) => (s ? (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).replace(/_/g, " ") : "");

window.admGet = admGet;
window.admSend = admSend;
window.admMoney = admMoney;
window.admDate = admDate;
window.admCap = admCap;

document.addEventListener("alpine:init", () => {
  Alpine.data("admShell", () => ({
    sidebarOpen: false,
    menuOpen: false,
    busy: false,
    theme: "dark",

    init() {
      try {
        const s = localStorage.getItem("qfs-theme");
        if (s === "light" || s === "dark") this.theme = s;
      } catch (_) {
        /* storage optional */
      }
    },

    toggleTheme() {
      this.theme = this.theme === "light" ? "dark" : "light";
      try {
        localStorage.setItem("qfs-theme", this.theme);
      } catch (_) {
        /* storage optional */
      }
    },

    async logout() {
      if (this.busy) return;
      this.busy = true;
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch (_) {
        /* best effort */
      }
      location.href = "/admin/login";
    },
  }));

  // Paginated list page. config: { endpoint, searchParam?, status? }
  Alpine.data("admList", (config) => ({
    endpoint: config.endpoint,
    searchParam: config.searchParam || "q",
    rows: [],
    total: 0,
    page: 1,
    totalPages: 1,
    loading: true,
    error: "",
    query: "",
    filters: config.filters || {},
    toast: "",
    // Approve/reject modal state (used by requests, loans, kyc, investments).
    decision: null,
    note: "",
    txHash: "",
    decisionBusy: false,
    decisionError: "",

    async init() {
      await this.load();
    },

    openDecision(row, action) {
      this.decision = { row, action };
      this.note = "";
      this.txHash = row.txHash || "";
      this.decisionError = "";
    },

    closeDecision() {
      if (!this.decisionBusy) this.decision = null;
    },

    // path built by the caller (it has access to decision/filters); extra merges in.
    async confirmDecision(path, extra, method = "PATCH") {
      if (this.decisionBusy || !this.decision) return;
      this.decisionBusy = true;
      this.decisionError = "";
      try {
        const body = { action: this.decision.action, ...(this.note.trim() ? { note: this.note.trim() } : {}), ...(extra || {}) };
        await admSend(path, method, body);
        this.decision = null;
        this.toast = "Review completed.";
        await this.load();
        setTimeout(() => (this.toast = ""), 2500);
      } catch (e) {
        this.decisionError = e.message;
      } finally {
        this.decisionBusy = false;
      }
    },

    buildParams() {
      const p = new URLSearchParams({ page: this.page });
      if (this.query.trim()) p.set(this.searchParam, this.query.trim());
      Object.entries(this.filters).forEach(([k, v]) => {
        if (v && v !== "ALL") p.set(k, v);
      });
      return p.toString();
    },

    async load() {
      this.loading = true;
      this.error = "";
      try {
        const d = await admGet(this.endpoint + "?" + this.buildParams());
        this.rows = d.items || [];
        this.total = d.total || 0;
        this.page = d.page || 1;
        this.totalPages = d.totalPages || 1;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    go(p) {
      if (p < 1 || p > this.totalPages) return;
      this.page = p;
      this.load();
    },

    search() {
      this.page = 1;
      this.load();
    },

    async act(path, method, body, message) {
      try {
        await admSend(path, method, body);
        this.toast = message || "Done.";
        await this.load();
        setTimeout(() => (this.toast = ""), 2500);
      } catch (e) {
        this.error = e.message;
      }
    },

    money: admMoney,
    date: admDate,
    cap: admCap,
    pill(s) {
      return (s || "").toLowerCase();
    },
  }));

  // Array endpoint with a per-item action modal (investments, swaps).
  // config: { endpoint, pendingParam? }
  Alpine.data("admArray", (config) => ({
    rows: [],
    loading: true,
    error: "",
    selected: null,
    busy: false,
    actionError: "",
    toast: "",
    pending: true,
    form: {},

    async init() {
      await this.load();
    },

    endpointUrl() {
      if (config.pendingParam) return config.endpoint + (this.pending ? "?" + config.pendingParam : "");
      return config.endpoint;
    },

    async load() {
      this.loading = true;
      this.error = "";
      try {
        const d = await admGet(this.endpointUrl());
        this.rows = Array.isArray(d) ? d : d.items || [];
        this.extra = Array.isArray(d) ? {} : d;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    open(item) {
      this.selected = item;
      this.actionError = "";
      this.form = {};
    },

    close() {
      if (!this.busy) this.selected = null;
    },

    async run(path, body, successMsg, method = "PATCH") {
      if (this.busy) return;
      this.busy = true;
      this.actionError = "";
      try {
        await admSend(path, method, body);
        this.selected = null;
        this.toast = successMsg || "Done.";
        await this.load();
        setTimeout(() => (this.toast = ""), 3000);
      } catch (e) {
        this.actionError = e.message;
      } finally {
        this.busy = false;
      }
    },

    money: admMoney,
    date: admDate,
    cap: admCap,
  }));

  // Users: list + filters + suspend/activate/role + balance adjustment.
  Alpine.data("admUsers", () => ({
    rows: [],
    total: 0,
    page: 1,
    totalPages: 1,
    loading: true,
    error: "",
    query: "",
    role: "ALL",
    status: "ALL",
    toast: "",
    busy: false,
    adjust: null,
    adjDir: "CREDIT",
    adjAmount: "",
    adjNote: "",
    adjError: "",
    editing: null,
    editForm: {},
    deleting: null,
    deleteForm: {},
    deleteError: "",
    openDelete(row) {
      this.deleting = row;
      this.deleteForm = { confirmation: "", reason: "", currentPassword: "", code: "" };
      this.deleteError = "";
    },
    closeDelete() { if (!this.busy) { this.deleting = null; this.deleteForm = {}; } },
    async deleteUser() {
      if (this.busy || !this.deleting) return;
      this.busy = true; this.deleteError = "";
      try {
        await admSend("/api/admin/users/" + encodeURIComponent(this.deleting.id), "PATCH", { action: "DELETE", ...this.deleteForm });
        this.deleting = null; this.deleteForm = {};
        this.toast = "Account deleted. Financial and audit records retained.";
        await this.load();
      } catch (error) { this.deleteError = error.message; } finally { this.busy = false; }
    },

    async init() {
      await this.load();
    },

    openEdit(row) {
      this.editing = row;
      this.editForm = { name: row.name, phone: row.phone || "", country: row.country || "", email: row.email, reason: "", currentPassword: "", code: "" };
      this.error = "";
    },

    closeEdit() {
      if (!this.busy) { this.editing = null; this.editForm = {}; this.error = ""; }
    },

    async saveProfile() {
      if (this.busy || !this.editing) return;
      this.busy = true;
      this.error = "";
      try {
        const result = await admSend("/api/admin/users/" + this.editing.id, "PATCH", { action: "UPDATE_PROFILE", ...this.editForm });
        this.editing = null;
        this.editForm = {};
        this.toast = result.sessionsRevoked ? "Account details updated. The email changed, so the user must sign in again." : "Account details updated.";
        await this.load();
        setTimeout(() => (this.toast = ""), 6000);
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },

    async load() {
      this.loading = true;
      this.error = "";
      try {
        const q = new URLSearchParams({ page: this.page, limit: 20 });
        if (this.query.trim()) q.set("search", this.query.trim());
        if (this.role !== "ALL") q.set("role", this.role);
        if (this.status !== "ALL") q.set("status", this.status);
        const d = await admGet("/api/admin/users?" + q);
        this.rows = d.items || [];
        this.total = d.total || 0;
        this.page = d.page || 1;
        this.totalPages = d.totalPages || 1;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    go(p) {
      if (p < 1 || p > this.totalPages) return;
      this.page = p;
      this.load();
    },

    search() {
      this.page = 1;
      this.load();
    },

    async userAction(id, action, role) {
      if (this.busy) return;
      this.busy = true;
      try {
        await admSend("/api/admin/users/" + id, "PATCH", { action, role });
        this.toast = action === "SUSPEND" ? "User suspended" : action === "ACTIVATE" ? "User activated" : "Role set to " + role;
        await this.load();
        setTimeout(() => (this.toast = ""), 2500);
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },

    openAdjust(row) {
      this.adjust = row;
      this.adjDir = "CREDIT";
      this.adjAmount = "";
      this.adjNote = "";
      this.adjError = "";
    },

    openAdjustAll() { this.openAdjust({ scope: "ALL", name: "All non-admin accounts", availableCents: 0 }); },
    closeAdjust() {
      if (!this.busy) this.adjust = null;
    },

    async submitAdjust() {
      if (this.busy || !this.adjAmount) return;
      if (this.adjNote.trim().length < 3) { this.adjError = "Enter a reason with at least three characters."; return; }
      this.busy = true;
      this.adjError = "";
      try {
        const result = await admSend("/api/admin/adjustments", "POST", {
          scope: this.adjust.scope || "USER",
          ...(this.adjust.id ? { userId: this.adjust.id } : {}),
          direction: this.adjDir,
          amount: this.adjAmount,
          note: this.adjNote.trim() || undefined,
        });
        const all = this.adjust.scope === "ALL";
        this.adjust = null;
        this.toast = all ? result.applied + " accounts adjusted; " + result.skipped + " skipped." : "Balance adjusted.";
        await this.load();
        setTimeout(() => (this.toast = ""), 2500);
      } catch (e) {
        this.adjError = e.message;
      } finally {
        this.busy = false;
      }
    },

    money: admMoney,
    date: admDate,
    cap: admCap,
    pill(s) {
      return (s || "").toLowerCase();
    },
  }));

  // KYC queue + review modal.
  Alpine.data("admKyc", () => ({
    rows: [],
    total: 0,
    page: 1,
    totalPages: 1,
    loading: true,
    error: "",
    status: "PENDING",
    query: "",
    selected: null,
    record: null,
    reviewLoading: false,
    reviewError: "",
    note: "",
    checked: false,
    busy: false,
    message: "",

    async init() {
      await this.load();
    },

    async load() {
      this.loading = true;
      this.error = "";
      try {
        const d = await admGet(`/api/admin/kyc?status=${this.status}&page=${this.page}&search=${encodeURIComponent(this.query)}`);
        this.rows = d.items || [];
        this.total = d.total || 0;
        this.page = d.page || 1;
        this.totalPages = d.totalPages || 1;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    go(p) {
      if (p < 1 || p > this.totalPages) return;
      this.page = p;
      this.load();
    },

    search() {
      this.page = 1;
      this.load();
    },

    async open(item) {
      this.selected = item;
      this.record = null;
      this.note = "";
      this.checked = false;
      this.reviewError = "";
      this.message = "";
      this.reviewLoading = true;
      try {
        this.record = await admGet("/api/admin/kyc/" + item.id);
      } catch (e) {
        this.reviewError = e.message;
      } finally {
        this.reviewLoading = false;
      }
    },

    close() {
      if (!this.busy) {
        this.selected = null;
        this.record = null;
      }
    },

    async decide(action) {
      if (!this.record || this.busy) return;
      this.busy = true;
      this.reviewError = "";
      this.message = "";
      try {
        this.record = await admSend("/api/admin/kyc/" + this.selected.id, "PATCH", { action, version: this.record.version, note: this.note.trim() || undefined });
        await this.load();
        this.message = "Verification review completed. The user has been notified.";
      } catch (e) {
        this.reviewError = e.message;
      } finally {
        this.busy = false;
      }
    },

    fileLabel(kind) {
      return { IDENTITY_FRONT: "Identity document — front / passport page", IDENTITY_BACK: "Identity document — back", PORTRAIT: "Face photo" }[kind] || kind;
    },

    date: admDate,
    cap: admCap,
  }));

  // Content CRUD (documents, reviews, markets, plans). config: { resource, defaults, mapEdit? }
  Alpine.data("admContent", (config) => ({
    resource: config.resource,
    rows: [],
    loading: true,
    error: "",
    toast: "",
    editing: null,
    form: {},
    busy: false,
    formError: "",
    deleting: null,
    documents: [], uploadFile: null, translationLocale: "es", translationDraft: {}, translationReviewed: false,
    selectTranslation() { this.translationDraft = { description: "", terms: "", riskDisclosure: "", ...(this.form.translations?.[this.translationLocale] || {}) }; this.translationReviewed = false; },
    async applyTranslation() {
      if (!this.translationReviewed) { this.formError = "Confirm the translation has been reviewed."; return; }
      const fields = ["description", "terms", "riskDisclosure"];
      for (const field of fields) {
        if (this.form[field] && !String(this.translationDraft[field] || "").trim()) { this.formError = "Complete all published plan material fields in this translation."; return; }
      }
      const locale = this.translationLocale, draft = { ...this.translationDraft };
      try {
        const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fields.map(field => this.form[field] || "").join("\0")));
        this.form.translations[locale] = { ...draft, sourceHash: Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("") };
        this.formError = "";
      } catch (_) { this.formError = "Use a secure HTTPS connection to publish a reviewed translation."; }
    },
    removeTranslation() { delete this.form.translations[this.translationLocale]; this.selectTranslation(); },

    async init() {
      await this.load();
      if (this.resource === "plans") { try { this.documents = await admGet("/api/admin/documents"); } catch (error) { this.error = error.message; } }
    },

    async load() {
      this.loading = true;
      this.error = "";
      try {
        const d = await admGet("/api/admin/" + this.resource);
        this.rows = Array.isArray(d) ? d : d.items || [];
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    openNew() {
      this.editing = "new";
      this.form = JSON.parse(JSON.stringify(config.defaults || {}));
      this.formError = ""; this.uploadFile = null;
      if (this.resource === "plans") { this.form.documentIds ??= []; this.form.translations ??= {}; this.selectTranslation(); }
    },

    openEdit(row) {
      this.editing = row.id;
      const base = JSON.parse(JSON.stringify(row));
      this.form = config.mapEdit ? config.mapEdit(base) : base;
      if ("isActive" in this.form) this.form.isActive = this.form.isActive === true || this.form.isActive === 1 || this.form.isActive === "1";
      this.formError = ""; this.uploadFile = null;
      if (this.resource === "plans") { this.form.documentIds ??= []; this.form.translations ??= {}; this.selectTranslation(); }
    },

    close() {
      if (!this.busy) this.editing = null;
    },

    async save() {
      if (this.busy) return;
      this.busy = true;
      this.formError = "";
      try {
        if (this.resource === "documents" && this.uploadFile) {
          if (this.uploadFile.size > 10 * 1024 * 1024) throw new Error("Choose a PDF no larger than 10 MB.");
          const form = new FormData();
          if (this.editing !== "new") form.set("id", this.editing);
          for (const field of ["code", "title", "flagPath", "sort"]) form.set(field, this.form[field] ?? (field === "sort" ? 0 : ""));
          form.set("isActive", this.form.isActive ? "1" : "0"); form.set("file", this.uploadFile);
          await admSend("/api/admin/documents/upload", "POST", form);
        } else if (this.editing === "new") {
          await admSend("/api/admin/" + this.resource, "POST", this.form);
        } else {
          await admSend("/api/admin/" + this.resource + "/" + this.editing, "PATCH", this.form);
        }
        this.editing = null;
        this.toast = "Saved.";
        await this.load();
        setTimeout(() => (this.toast = ""), 2500);
      } catch (e) {
        this.formError = e.message;
      } finally {
        this.busy = false;
      }
    },

    async remove(id) {
      if (this.busy) return;
      this.busy = true;
      try {
        await admSend("/api/admin/" + this.resource + "/" + id, "DELETE");
        this.deleting = null;
        this.toast = "Deleted.";
        await this.load();
        setTimeout(() => (this.toast = ""), 2500);
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },

    money: admMoney,
    date: admDate,
    cap: admCap,
  }));

  Alpine.data("admReceivingWallets", () => ({
    data: null,
    error: "",
    loading: true,
    busy: false,
    editor: null,
    editorError: "",
    toast: "",

    async init() {
      await this.load();
    },

    async load() {
      this.loading = true;
      this.error = "";
      try {
        this.data = await admGet("/api/admin/receiving-wallets");
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    openEditor(wallet) {
      this.editorError = "";
      this.editor = wallet
        ? { id: wallet.id, assetKey: wallet.assetKey, label: wallet.label, address: wallet.address, destinationTag: wallet.destinationTag ?? "" }
        : { assetKey: "ETH", label: "", address: "", destinationTag: "" };
    },

    async save() {
      if (!this.editor || this.busy) return;
      this.busy = true;
      this.editorError = "";
      try {
        const body = {
          label: this.editor.label.trim(),
          address: this.editor.address.trim(),
          destinationTag: this.editor.assetKey === "XRP" ? this.editor.destinationTag.trim() || null : null,
        };
        if (this.editor.id) {
          await admSend("/api/admin/receiving-wallets/" + this.editor.id, "PATCH", body);
        } else {
          await admSend("/api/admin/receiving-wallets", "POST", { ...body, assetKey: this.editor.assetKey });
        }
        this.editor = null;
        this.toast = "Receiving wallet saved";
        await this.load();
        setTimeout(() => (this.toast = ""), 2500);
      } catch (e) {
        this.editorError = e.message;
      } finally {
        this.busy = false;
      }
    },

    async toggle(wallet) {
      if (this.busy) return;
      this.busy = true;
      try {
        await admSend("/api/admin/receiving-wallets/" + wallet.id, "PATCH", { isActive: !wallet.isActive });
        this.toast = "Receiving wallet updated";
        await this.load();
        setTimeout(() => (this.toast = ""), 2500);
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },

    assetEntries() {
      return Object.entries(this.data?.assets || {});
    },
  }));

  Alpine.data("admMailSettings", () => ({
    mail: null,
    mailLoading: true,
    mailBusy: false,
    mailError: "",
    mailToast: "",
    mailPassword: "",
    testEmail: "",

    async init() {
      await this.loadMail();
    },

    async loadMail() {
      this.mailLoading = true;
      this.mailError = "";
      try {
        this.mail = await admGet("/api/admin/mail-settings");
        this.mail.port = Number(this.mail.port) || 587;
        if (!this.mail.encryption) this.mail.encryption = "tls";
      } catch (e) {
        this.mailError = e.message;
      } finally {
        this.mailLoading = false;
      }
    },

    async saveMail() {
      if (!this.mail || this.mailBusy) return;
      this.mailBusy = true;
      this.mailError = "";
      try {
        const body = {
          host: (this.mail.host || "").trim(),
          port: this.mail.port,
          encryption: this.mail.encryption || "tls",
          username: (this.mail.username || "").trim(),
          fromAddress: (this.mail.fromAddress || "").trim(),
          fromName: (this.mail.fromName || "").trim(),
          accountEmails: !!this.mail.accountEmails,
        };
        if (this.mailPassword) body.password = this.mailPassword;
        this.mail = await admSend("/api/admin/mail-settings", "POST", body);
        this.mail.port = Number(this.mail.port) || 587;
        this.mailPassword = "";
        this.mailToast = "SMTP settings saved";
        setTimeout(() => (this.mailToast = ""), 2500);
      } catch (e) {
        this.mailError = e.message;
      } finally {
        this.mailBusy = false;
      }
    },

    async sendTest() {
      if (!this.testEmail || this.mailBusy) return;
      this.mailBusy = true;
      this.mailError = "";
      try {
        await admSend("/api/admin/mail-settings/test", "POST", { email: this.testEmail.trim() });
        this.mailToast = "Test email sent";
        setTimeout(() => (this.mailToast = ""), 2500);
      } catch (e) {
        this.mailError = e.message;
      } finally {
        this.mailBusy = false;
      }
    },
  }));

  Alpine.data("admSwapConfig", () => ({
    data: null,
    error: "",
    loading: true,
    busy: false,
    editor: null,
    toast: "",

    async init() {
      await this.load();
    },

    async load() {
      this.loading = true;
      this.error = "";
      try {
        this.data = await admGet("/api/admin/swaps/configuration");
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    openRoute(assetKey) {
      const route = this.data?.routes?.find((r) => r.assetKey === assetKey);
      const provider = this.data?.currencies?.find((c) => c.assetKey === assetKey && c.enabled);
      this.editor = route ?? {
        assetKey,
        providerTicker: provider?.ticker ?? "",
        walletId: this.data?.wallets?.find((w) => w.assetKey === assetKey)?.id ?? "",
        isActive: true,
      };
      this.error = "";
    },

    async save() {
      if (!this.editor || this.busy) return;
      this.busy = true;
      this.error = "";
      try {
        await admSend("/api/admin/swaps/configuration", "PUT", this.editor);
        this.editor = null;
        this.toast = "Swap configuration saved";
        await this.load();
        setTimeout(() => (this.toast = ""), 2500);
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },

    assetKeys() {
      return Object.keys(this.data?.assets || {});
    },

    routeFor(assetKey) {
      return this.data?.routes?.find((r) => r.assetKey === assetKey);
    },

    walletLabel(walletId) {
      return this.data?.wallets?.find((w) => w.id === walletId)?.label ?? "No treasury route configured";
    },
  }));

  // Single-resource fetch. config: { endpoint }
  Alpine.data("admData", (config) => ({
    data: null,
    loading: true,
    error: "",

    async init() {
      await this.load();
    },

    async load() {
      this.loading = true;
      this.error = "";
      try {
        this.data = await admGet(config.endpoint);
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    money: admMoney,
    date: admDate,
    cap: admCap,
  }));
});
