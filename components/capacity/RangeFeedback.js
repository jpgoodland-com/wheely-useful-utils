"use client";

import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { diffDays, formatDate } from "@/lib/capacity/dates";
import styles from "./Capacity.module.css";

/**
 * Visual feedback when the date range changes. `trigger()` is called from the
 * change handler; the highlight clears itself when its CSS animation ends.
 */
export function useRangePulse() {
  const [pulseId, setPulseId] = useState(0);
  const [pulsing, setPulsing] = useState(false);
  return {
    pulseId,
    pulsing,
    trigger: () => {
      setPulseId((n) => n + 1);
      setPulsing(true);
    },
    onAnimationEnd: (e) => {
      if (e.animationName?.includes("rangePulse")) setPulsing(false);
    },
  };
}

/** "6 Sprints in view · Oct 5 – Dec 27, 2026 · 12 weeks", announced to screen readers. */
export function RangeSummary({ columns, noun, pulse }) {
  const count = columns.length;
  const plural = count === 1 ? noun : `${noun}s`;
  const first = columns[0];
  const last = columns[count - 1];
  const weeks = count ? Math.round((diffDays(first.start, last.end) + 1) / 7) : 0;

  return (
    <div
      key={pulse.pulseId}
      className={`${styles.rangeSummary} ${pulse.pulsing ? styles.rangeSummaryPulse : ""}`}
      role="status"
      aria-live="polite"
    >
      <CalendarRange size={16} aria-hidden="true" />
      <span>
        <strong>{count}</strong> {plural} in view
        {count > 0 && (
          <span className={styles.muted}>
            {" "}
            · {formatDate(first.start)} – {formatDate(last.end, { month: "short", day: "numeric", year: "numeric" })} · {weeks} {weeks === 1 ? "week" : "weeks"}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Wraps a grid so a range change remounts it (scrolling back to the start of
 * the new range) and briefly highlights its border and scrollbar.
 */
export function RangePulseFrame({ pulse, children }) {
  return (
    <div key={pulse.pulseId} className={pulse.pulsing ? styles.rangePulse : undefined} onAnimationEnd={pulse.onAnimationEnd}>
      {children}
    </div>
  );
}
