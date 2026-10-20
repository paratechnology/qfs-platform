"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  /** fadeInUp (default) or fadeIn */
  animation?: "fadeInUp" | "fadeIn";
  /** animation delay in ms */
  delay?: number;
  /** animation duration in ms (elementor widgets 1250, ekit widgets 1500, slow 2000) */
  duration?: number;
  className?: string;
  style?: CSSProperties;
};

export default function Reveal({
  children,
  animation = "fadeInUp",
  delay = 0,
  duration = 1250,
  className = "",
  style,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={[
        "reveal",
        visible ? `animated ${animation}` : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        animationDelay: `${delay}ms`,
        animationDuration: `${duration}ms`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}