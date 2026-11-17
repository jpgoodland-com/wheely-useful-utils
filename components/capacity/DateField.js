"use client";

import { useRef } from "react";
import { CalendarDays } from "lucide-react";
import styles from "./Capacity.module.css";

/**
 * Native date input with a visible calendar button. The browser's own picker
 * icon is near-invisible on the dark theme, so clicking the field or the button
 * opens the picker; typing still works for keyboard users.
 */
export function DateField({ id, value, onChange, disabled, min, max, label, className = "" }) {
  const inputRef = useRef(null);

  const openPicker = () => {
    const input = inputRef.current;
    if (!input || disabled) return;
    try {
      input.showPicker?.();
    } catch {
      // showPicker throws if not triggered by a user gesture or unsupported; focus instead.
    }
    input.focus();
  };

  return (
    <div className={`${styles.dateField} ${className}`}>
      <input
        ref={inputRef}
        id={id}
        className={`form-input ${styles.dateInput}`}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={onChange}
        onClick={openPicker}
        aria-label={id ? undefined : label}
      />
      <button type="button" className={styles.dateBtn} onClick={openPicker} disabled={disabled} aria-label={`Choose ${label || "date"} from calendar`}>
        <CalendarDays size={16} />
      </button>
    </div>
  );
}
