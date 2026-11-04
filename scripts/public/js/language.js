document.addEventListener("alpine:init", () => {
  Alpine.data("languageSelector", () => ({
    locale: document.documentElement.lang?.replace(/-/g, "_") || "en",
    pending: false,
    error: "",
    lock: false,

    init() {
      const match = document.documentElement.getAttribute("lang");
      if (match) this.locale = match;
      this._compactMq = window.matchMedia("(max-width: 640px)");
      this._onCompactChange = () => this.syncCompactLabels();
      this._compactMq.addEventListener("change", this._onCompactChange);
      this.$nextTick(() => this.syncCompactLabels());
    },

    syncCompactLabels() {
      const compact = this._compactMq?.matches ?? false;
      const root = this.$root;
      root.classList.toggle("language-compact", compact);
      const sel = root.querySelector("select");
      if (!sel) return;
      sel.querySelectorAll("option").forEach((opt) => {
        if (!opt.dataset.full) opt.dataset.full = opt.textContent;
        const abbr = opt.dataset.abbr;
        opt.textContent = compact && abbr ? abbr : opt.dataset.full;
      });
    },

    async change(selected) {
      if (this.lock || selected === this.locale) return;
      this.lock = true;
      this.pending = true;
      this.error = "";
      try {
        const res = await fetch("/api/auth/locale", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: selected }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) throw new Error((json && json.error && json.error.message) || "Could not change language.");
        location.reload();
      } catch (e) {
        this.error = e.message || "Could not change language. Please try again.";
        this.lock = false;
        this.pending = false;
      }
    },
  }));
});
