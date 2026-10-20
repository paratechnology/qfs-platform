"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReviewItem } from "@/lib/api-types";
import { useText } from "@/lib/i18n/text";
import { ChevronRight, RightArrow, Star } from "./icons";

/** Randomness changes the order, never the pairing of author and review. */
export default function ReviewReel({ reviews, illustrative = false, suspended, onExplore, onWrite }: {
  reviews: ReviewItem[];
  illustrative?: boolean;
  suspended: boolean;
  onExplore: () => void;
  onWrite: () => void;
}) {
  const tx = useText();
  const root = useRef<HTMLElement>(null);
  // Overview polling supplies new arrays. Identical content must not restart playback.
  const signature = JSON.stringify(reviews);
  const items = useMemo(() => (JSON.parse(signature) as ReviewItem[])
    .filter(review => review.name.trim() && review.text.trim()), [signature]);
  const [order, setOrder] = useState<number[]>([]);
  const [position, setPosition] = useState(0);
  const [sequence, setSequence] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    const next = items.map((_, index) => index);
    for (let index = next.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [next[index], next[other]] = [next[other], next[index]];
    }
    setOrder(next);
    setPosition(0);
    setSequence(0);
  }, [items]);

  useEffect(() => {
    try { setPaused(localStorage.getItem("qfs-review-reel-paused") === "true"); } catch { /* Storage is optional. */ }
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(motion.matches);
    const syncVisibility = () => setHidden(document.hidden);
    syncMotion(); syncVisibility();
    motion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      motion.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (!root.current || !items.length) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.2 });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [items.length]);

  const current = items[order[position] ?? 0] ?? items[0];
  const playing = items.length > 1 && !paused && !hovered && !focused && !hidden && visible && !suspended && !reducedMotion;
  const duration = current ? Math.min(24000, Math.max(12000, current.text.split(/\s+/).length * 350)) : 12000;
  const cinematic = sequence % 3 === 2;

  useEffect(() => {
    if (!playing) return;
    const timeout = setTimeout(() => {
      setPosition(value => (value + 1) % items.length);
      setSequence(value => value + 1);
    }, duration);
    return () => clearTimeout(timeout);
  }, [playing, duration, position, items.length, signature]);

  const move = (direction: number) => {
    setPosition(value => (value + direction + items.length) % items.length);
    setSequence(value => value + 1);
  };
  const toggle = () => {
    setPaused(value => {
      try { localStorage.setItem("qfs-review-reel-paused", String(!value)); } catch { /* Storage is optional. */ }
      return !value;
    });
  };

  if (!current) return (
    <section className="dash-review-invite" aria-label={tx("Customer voices")}>
      <div><strong>{tx("Share your experience")}</strong><span>{tx("Your review appears here after approval.")}</span></div>
      <button className="dash-btn ghost" onClick={onWrite}>{tx("Write a Review")}<RightArrow size={15} /></button>
    </section>
  );

  return (
    <section ref={root} className="dash-review-reel" aria-label={tx("Customer voices")} aria-roledescription="carousel"
      onPointerEnter={event => { if (event.pointerType === "mouse") setHovered(true); }} onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)} onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}>
      <header className="dash-reel-header">
        <div className="dash-reel-heading"><span className="dash-reel-eyebrow">{tx("Customer voices")}</span><span className="dash-reel-caption">{tx(illustrative ? "Illustrative reviews" : "From our community")}</span></div>
        {items.length > 1 && !reducedMotion && <div className="dash-reel-controls">
            <button type="button" className="dash-reel-control" onClick={toggle} aria-label={tx(paused ? "Play reviews" : "Pause reviews")} aria-pressed={paused}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                {paused ? <path d="M4 2.5v11L13 8Z" /> : <path d="M4 3h3v10H4zm5 0h3v10H9z" />}
              </svg>
            </button>
        </div>}
      </header>
      <div className={`dash-reel-stage${cinematic ? " cinematic" : ""}`} aria-live="off">
        <article className="dash-reel-slide" key={`${sequence}-${current.name}`} aria-roledescription="slide"
          aria-label={tx("Review {current} of {total}", { current: position + 1, total: items.length })}>
          <blockquote dir="auto">{current.text}</blockquote>
          <div className="dash-reel-author">
            <span className="dash-reel-avatar" aria-hidden="true">{Array.from(current.name.trim())[0]}</span>
            <div><b dir="auto">{current.name}</b><span className="dash-reel-stars" aria-label={tx("{rating} out of 5 stars", { rating: current.stars })}>
              {Array.from({ length: Math.max(0, Math.min(5, current.stars)) }, (_, index) => <Star size={11} key={index} />)}
            </span></div>
          </div>
        </article>
      </div>
      <footer className="dash-reel-footer">
        <button type="button" className="dash-section-link" onClick={onExplore}>{tx("Read all reviews")}<RightArrow size={14} /></button>
        <div className="dash-reel-navigation" role="group" aria-label={tx("Reviews")}>
          {items.length > 1 && <button type="button" className="dash-reel-control previous" aria-label={tx("Previous review")} onClick={() => move(-1)}><ChevronRight size={17} /></button>}
          <span className="dash-reel-count" aria-hidden="true">{tx.number(position + 1, { minimumIntegerDigits: 2 })}<span> / {tx.number(items.length, { minimumIntegerDigits: 2 })}</span></span>
          {items.length > 1 && <button type="button" className="dash-reel-control next" aria-label={tx("Next review")} onClick={() => move(1)}><ChevronRight size={17} /></button>}
        </div>
      </footer>
      <div className="dash-reel-progress" aria-hidden="true"><span key={`${sequence}-${playing}`} style={{ animationDuration: `${duration}ms`, animationPlayState: playing ? "running" : "paused" }} /></div>
    </section>
  );
}
