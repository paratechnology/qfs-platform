"use client";
import { useText } from "@/lib/i18n/text";


import { useEffect, useRef, useState, type CSSProperties } from "react";

const BARS = [
  { title: "Synchronization", value: 90 },
  { title: "Decentralization", value: 85 },
  { title: "Security", value: 99 },
  { title: "Transparency", value: 95 },
];

function SkillBar({
  title,
  value,
  active,
}: {
  title: string;
  value: number;
  active: boolean;
}) {
  const tx = useText();
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!active) return;
    const start = performance.now();
    const duration = 3500;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setN(Math.round(value * p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, value]);

  const style: CSSProperties = active
    ? { width: `${value}%`, transition: "width 3.5s ease" }
    : { width: 0, transition: "none" };

  return (
    <div className="skill-bar-group">
      <div className="skill-bar-content">
        <span className="skill-title">{tx(title)}</span>
      </div>
      <div className="skill-bar">
        <div className="skill-track" style={style}>
          <div className="number-percentage-wraper">
            <span className="number-percentage">
              {active ? n : value}
            </span>
            %
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProgressBars() {
  const tx = useText();
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActive(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section className="progress-section" ref={ref}>
      <div className="container">
        <div className="progress-grid">
          <div>
            <SkillBar title={tx(BARS[0].title)} value={BARS[0].value} active={active} />
            <SkillBar title={tx(BARS[1].title)} value={BARS[1].value} active={active} />
          </div>
          <div>
            <SkillBar title={tx(BARS[2].title)} value={BARS[2].value} active={active} />
            <SkillBar title={tx(BARS[3].title)} value={BARS[3].value} active={active} />
          </div>
        </div>
      </div>
    </section>
  );
}