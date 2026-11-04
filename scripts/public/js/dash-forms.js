/*
 * Dashboard form views: account settings and identity verification (KYC).
 * Both call the existing JSON API. Plain Alpine, no build step.
 */
async function apiRequest(path, method = "GET", body) {
  const opts = { method, cache: "no-store" };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !json.ok) throw new Error((json && json.error && json.error.message) || "Something went wrong. Please try again.");
  return json.data;
}

document.addEventListener("alpine:init", () => {
  // ---------- Account settings ----------
  Alpine.data("accountSettings", () => ({
    data: null,
    error: "",
    message: "",
    busy: "",
    setup: null,
    codes: [],
    revokeId: "",
    manageAction: "RECOVERY_CODES",

    async init() {
      await this.load();
    },

    async load() {
      this.error = "";
      try {
        this.data = await apiRequest("/api/account/security");
      } catch (e) {
        this.error = e.message;
      }
    },

    async submit(event, action) {
      event.preventDefault();
      const form = event.target;
      const values = Object.fromEntries(new FormData(form).entries());
      this.busy = action;
      this.error = "";
      this.message = "";
      this.codes = [];
      try {
        if (action === "profile") {
          await apiRequest("/api/account/profile", "PATCH", values);
          this.message = "Profile saved.";
        } else if (action === "password") {
          await apiRequest("/api/account/password", "POST", values);
          form.reset();
          this.setup = null;
          this.message = "Password changed. Other devices have been signed out.";
        } else if (action === "setup") {
          this.setup = await apiRequest("/api/account/two-factor/setup", "POST", values);
          form.reset();
        } else if (action === "revoke") {
          await apiRequest("/api/account/sessions/" + encodeURIComponent(this.revokeId), "DELETE", values);
          this.revokeId = "";
          form.reset();
          this.message = "Selected sessions signed out.";
        } else {
          const result = await apiRequest("/api/account/two-factor", "POST", { ...values, action });
          this.codes = result.recoveryCodes || [];
          this.setup = null;
          form.reset();
          this.message = action === "DISABLE" ? "Two-factor authentication disabled. Other devices have been signed out." : "Security updated. Save your recovery codes somewhere private.";
        }
        await this.load();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = "";
      }
    },

    downloadCodes() {
      const blob = new Blob(["QFS recovery codes\n\n" + this.codes.join("\n")], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "qfs-recovery-codes.txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    date(d) {
      return d ? new Date(d).toLocaleString() : "";
    },
  }));

  // ---------- Identity verification (KYC) ----------
  Alpine.data("kycFlow", (name) => ({
    record: null,
    loading: true,
    error: "",
    message: "",
    busy: "",
    step: 0,
    consent: false,
    fields: { legalName: name || "", dateOfBirth: "", country: "", address: "", documentType: "PASSPORT" },

    async init() {
      await this.load();
    },

    async load() {
      this.loading = true;
      this.error = "";
      try {
        const current = await apiRequest("/api/kyc");
        this.record = current;
        this.fields = { ...this.fields, ...current.details };
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    get required() {
      return ["IDENTITY_FRONT", ...(this.fields.documentType === "PASSPORT" ? [] : ["IDENTITY_BACK"]), "PORTRAIT"];
    },

    get complete() {
      return this.required.every((kind) => this.record && this.record.files.some((f) => f.kind === kind));
    },

    label(kind) {
      return {
        IDENTITY_FRONT: this.fields.documentType === "PASSPORT" ? "Passport photo page" : "Identity document — front",
        IDENTITY_BACK: "Identity document — back",
        PORTRAIT: "Photo of your face",
      }[kind];
    },

    hasFile(kind) {
      return !!(this.record && this.record.files.some((f) => f.kind === kind));
    },

    fileUrl(kind) {
      const f = this.record && this.record.files.find((x) => x.kind === kind);
      return f ? f.url : "";
    },

    async act(label, task) {
      this.busy = label;
      this.error = "";
      this.message = "";
      try {
        const next = await task();
        this.record = next;
        this.message = "Verification details saved.";
        return next;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = "";
      }
    },

    async saveDetails() {
      const r = await this.act("Saving details…", () => apiRequest("/api/kyc", "POST", this.fields));
      if (r) this.step = 1;
    },

    async upload(kind, event) {
      const file = event.target.files[0];
      event.target.value = "";
      if (!file) return;
      if (file.size > 3 * 1024 * 1024) {
        this.error = "Each file must be 3 MB or smaller.";
        return;
      }
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      await this.act("Uploading document…", () => apiRequest("/api/kyc/files", "POST", form));
    },

    async submitReview() {
      await this.act("Submitting for review…", () => apiRequest("/api/kyc/submit", "POST", { consent: true }));
    },
  }));
});

// Restore account actions supported by the original API.
document.addEventListener("alpine:init", () => {
  Alpine.data("cardManager", () => ({
    cards: [], loading: true, busy: "", error: "", message: "",
    async init() { await this.load(); },
    async load() { try { this.cards = await apiRequest("/api/cards"); this.error = ""; } catch (error) { this.error = error.message; } finally { this.loading = false; } },
    async act(id, action) {
      if (this.busy) return;
      this.busy = id; this.error = ""; this.message = "";
      try { await apiRequest("/api/cards/" + encodeURIComponent(id), "PATCH", { action }); await this.load(); this.message = "Card updated."; }
      catch (error) { this.error = error.message; } finally { this.busy = ""; }
    },
  }));
  Alpine.data("reviewForm", () => ({
    rating: 5, text: "", busy: false, error: "", done: false,
    async submit() {
      if (this.busy || this.done) return;
      if (this.text.trim().length < 10) { this.error = "Write at least 10 characters."; return; }
      this.busy = true; this.error = "";
      try { await apiRequest("/api/reviews", "POST", { rating: Number(this.rating), text: this.text.trim() }); this.done = true; }
      catch (error) { this.error = error.message; } finally { this.busy = false; }
    },
  }));
  Alpine.data("reviewList", () => ({
    items: [], loading: true, error: "",
    async init() { await this.load(); },
    async load() { this.loading = true; try { this.items = await apiRequest("/api/reviews"); this.error = ""; } catch (error) { this.error = error.message; } finally { this.loading = false; } },
  }));
});
