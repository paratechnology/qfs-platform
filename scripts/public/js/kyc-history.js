document.addEventListener("alpine:init", () => {
  Alpine.data("kycHistory", endpoint => ({
    items: [], cursor: null, loaded: false, loading: false, error: "",
    async load(more = false) {
      if (this.loading) return;
      this.loading = true; this.error = "";
      try {
        const response = await fetch(endpoint + (more && this.cursor ? "?beforeVersion=" + encodeURIComponent(this.cursor) : ""), { cache: "no-store" });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error?.message || "Could not load verification history.");
        this.items = more ? [...this.items, ...json.data.items] : json.data.items;
        this.cursor = json.data.nextCursor; this.loaded = true;
      } catch (error) { this.error = error.message; } finally { this.loading = false; }
    },
    date(value) { return value ? new Date(value).toLocaleString() : ""; },
  }));
});
