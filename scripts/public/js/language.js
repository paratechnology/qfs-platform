document.addEventListener("alpine:init", () => {
  Alpine.data("languageSelector", () => ({
    locale: document.documentElement.lang?.replace(/-/g, "_") || "en",
    pending: false,
    error: "",
    lock: false,

    init() {
      const match = document.documentElement.getAttribute("lang");
      if (match) this.locale = match;
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
