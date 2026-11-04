/**
 * Customer review reel (parity with components/dashboard/ReviewReel.tsx).
 */
document.addEventListener("alpine:init", () => {
  Alpine.data("reviewReel", (initial) => ({
    items: (initial || []).filter((r) => (r.name || "").trim() && (r.text || "").trim()),
    illustrative: false,
    order: [],
    position: 0,
    sequence: 0,
    paused: false,
    hovered: false,
    focused: false,
    visible: false,
    hidden: document.hidden,
    reducedMotion: true,
    timer: null,

    init() {
      this.shuffle();
      try {
        this.paused = localStorage.getItem("qfs-review-reel-paused") === "true";
      } catch (_) {}
      const motion = matchMedia("(prefers-reduced-motion: reduce)");
      const syncMotion = () => {
        this.reducedMotion = motion.matches;
      };
      const syncVis = () => {
        this.hidden = document.hidden;
      };
      syncMotion();
      motion.addEventListener("change", syncMotion);
      document.addEventListener("visibilitychange", syncVis);
      const root = this.$root;
      if (root && this.items.length) {
        const obs = new IntersectionObserver(([e]) => {
          this.visible = e.isIntersecting;
        }, { threshold: 0.2 });
        obs.observe(root);
      }
      this.tick();
    },

    shuffle() {
      const next = this.items.map((_, i) => i);
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      this.order = next;
      this.position = 0;
      this.sequence = 0;
    },

    get current() {
      return this.items[this.order[this.position] ?? 0] ?? this.items[0];
    },

    get playing() {
      return this.items.length > 1 && !this.paused && !this.hovered && !this.focused && !this.hidden && this.visible && !this.reducedMotion;
    },

    get cinematic() {
      return this.sequence % 3 === 2;
    },

    get duration() {
      const t = this.current?.text || "";
      return Math.min(24000, Math.max(12000, t.split(/\s+/).length * 350));
    },

    tick() {
      if (this.timer) clearTimeout(this.timer);
      if (!this.playing) {
        this.timer = setTimeout(() => this.tick(), 500);
        return;
      }
      this.timer = setTimeout(() => {
        this.position = (this.position + 1) % this.items.length;
        this.sequence += 1;
        this.tick();
      }, this.duration);
    },

    move(dir) {
      this.position = (this.position + dir + this.items.length) % this.items.length;
      this.sequence += 1;
      this.tick();
    },

    toggle() {
      this.paused = !this.paused;
      try {
        localStorage.setItem("qfs-review-reel-paused", String(this.paused));
      } catch (_) {}
      this.tick();
    },
  }));

  Alpine.data("reviewRatings", (summary = {}) => ({
    stars: Array.isArray(summary.stars) ? summary.stars : [],
    total: Number(summary.total) || 0,
    average: Number(summary.average) || 0,
    scorePercent: Number(summary.scorePercent) || 0,
    shown: {},
    scoreShown: 0,
    playing: false,
    frame: 0,

    init() {
      this.reset();
    },

    reset() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.playing = false;
      this.shown = Object.fromEntries((this.stars || []).map((row) => [row.stars, 0]));
      this.scoreShown = 0;
    },

    play() {
      if (this.playing || this.total === 0) return;
      this.playing = true;
      const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        this.stars.forEach((row) => {
          this.shown[row.stars] = row.percent;
        });
        this.scoreShown = this.scorePercent;
        return;
      }
      const start = performance.now();
      const duration = 900;
      const tick = (now) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - p) ** 3;
        this.stars.forEach((row) => {
          this.shown[row.stars] = Math.round(row.percent * eased);
        });
        this.scoreShown = Math.round(this.scorePercent * eased * 10) / 10;
        if (p < 1) {
          this.frame = requestAnimationFrame(tick);
          return;
        }
        this.stars.forEach((row) => {
          this.shown[row.stars] = row.percent;
        });
        this.scoreShown = this.scorePercent;
      };
      this.frame = requestAnimationFrame(tick);
    },
  }));
});
