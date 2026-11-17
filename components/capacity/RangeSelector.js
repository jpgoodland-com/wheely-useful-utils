"use client";

import { useState } from "react";
import { addDays, isDateStr } from "@/lib/capacity/dates";
import { RANGE_PRESETS, clampRange } from "@/lib/capacity/range";
import { DateField } from "./DateField";
import styles from "./Capacity.module.css";

/** From/To date inputs plus presets. Ranges longer than 52 weeks are clamped. */
export function RangeSelector({ from, to, onChange }) {
  const [clamped, setClamped] = useState(false);

  const apply = (nextFrom, nextTo) => {
    if (!isDateStr(nextFrom) || !isDateStr(nextTo)) return;
    const r = clampRange(nextFrom, nextTo);
    setClamped(r.clamped);
    onChange({ from: r.from, to: r.to });
  };

  return (
    <div>
      <div className={styles.range}>
        <label>
          From
          <DateField label="start of range" value={from} onChange={(e) => apply(e.target.value, to)} />
        </label>
        <label>
          To
          <DateField label="end of range" value={to} onChange={(e) => apply(from, e.target.value)} />
        </label>
        <div className={styles.presets} role="group" aria-label="Range presets">
          {RANGE_PRESETS.map((p) => {
            const presetTo = addDays(from, p.days - 1);
            return (
              <button key={p.id} type="button" className={`${styles.chip} ${presetTo === to ? styles.chipActive : ""}`} onClick={() => apply(from, presetTo)}>
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
      {clamped && (
        <p className={styles.hint} role="status" style={{ marginTop: "0.5rem" }}>
          The range is limited to 52 weeks, so the end date was moved.
        </p>
      )}
    </div>
  );
}
