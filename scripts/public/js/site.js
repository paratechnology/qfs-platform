/*
 * Marketing-site behaviour (homepage): scroll reveals, the hero counter,
 * and the animated progress bars. Mirrors the old React Reveal/Counter/
 * SkillBar components. Plain JS, no build step.
 */
document.addEventListener("DOMContentLoaded", () => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasIO = "IntersectionObserver" in window;

  // Reveal on scroll: .reveal -> .animated .fadeInUp (or the data-reveal-anim).
  const reveals = document.querySelectorAll(".reveal");
  const reveal = (el) => {
    el.style.animationDelay = (el.dataset.revealDelay || 0) + "ms";
    if (el.dataset.revealDuration) el.style.animationDuration = el.dataset.revealDuration + "ms";
    el.classList.add("animated", el.dataset.revealAnim || "fadeInUp");
  };
  if (!hasIO || reduce) {
    reveals.forEach((el) => el.classList.add("animated", el.dataset.revealAnim || "fadeInUp"));
  } else {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          reveal(e.target);
          io.unobserve(e.target);
        }
      }),
      { threshold: 0.1 }
    );
    reveals.forEach((el) => io.observe(el));
  }

  // Hero counter: animate 0 -> data-counter once in view.
  document.querySelectorAll("[data-counter]").forEach((el) => {
    const target = parseFloat(el.dataset.counter);
    const suffix = el.dataset.suffix || "";
    const render = (v) => { el.textContent = v.toFixed(1) + suffix; };
    if (!hasIO || reduce) { render(target); return; }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const start = performance.now();
        const tick = (now) => {
          const p = Math.min(1, (now - start) / 2000);
          render(target * p);
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        io.disconnect();
      }),
      { threshold: 0.1 }
    );
    io.observe(el);
  });

  // Progress bars: grow width + count up once the section is in view.
  document.querySelectorAll("[data-progress]").forEach((section) => {
    const tracks = section.querySelectorAll(".skill-track");
    const run = () => tracks.forEach((track) => {
      const value = parseInt(track.dataset.skill, 10);
      const num = track.querySelector(".number-percentage");
      if (reduce) {
        track.style.width = value + "%";
        if (num) num.textContent = value;
        return;
      }
      track.style.transition = "width 3.5s ease";
      track.style.width = value + "%";
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - start) / 3500);
        if (num) num.textContent = Math.round(value * p);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (!hasIO) { run(); return; }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { run(); io.disconnect(); }
      }),
      { threshold: 0.2 }
    );
    io.observe(section);
  });
});
