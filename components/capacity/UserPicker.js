"use client";

import { useEffect, useId, useState } from "react";
import styles from "./Capacity.module.css";

/**
 * Typeahead over /api/users/search. Calls onSelect({ userId, fullName, ... })
 * for a picked result, or onSelect({ identifier }) when Enter is pressed on
 * free text (an exact email or username).
 */
export function UserPicker({ onSelect, excludeIds = [], placeholder = "Name, email or username", disabled, autoFocus }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(-1);
  const listId = useId();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return undefined;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.filter((u) => !excludeIds.includes(u.userId)));
          setActive(-1);
        }
      } catch {
        // Search is a convenience; typing an exact email still works.
      }
    }, 300);
    return () => clearTimeout(timer);
    // excludeIds is intentionally not a dependency: it changes identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const visible = query.trim().length >= 2 ? results : [];

  const pick = (choice) => {
    onSelect(choice);
    setQuery("");
    setResults([]);
    setActive(-1);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" && visible.length) {
      e.preventDefault();
      setActive((i) => (i + 1) % visible.length);
    } else if (e.key === "ArrowUp" && visible.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? visible.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && visible[active]) pick(visible[active]);
      else if (query.trim()) pick({ identifier: query.trim() });
    } else if (e.key === "Escape" && visible.length) {
      e.stopPropagation();
      setResults([]);
    }
  };

  return (
    <div className={styles.picker}>
      <input
        className="form-input"
        style={{ width: "100%", padding: "0.55rem 0.85rem", fontSize: "0.9rem" }}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-expanded={visible.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={100}
      />
      {visible.length > 0 && (
        <ul id={listId} role="listbox" className={styles.results}>
          {visible.map((u, i) => (
            <li key={u.userId} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`${styles.result} ${i === active ? styles.resultActive : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(u)}
                tabIndex={-1}
              >
                <span>{u.fullName}</span>
                <span className={styles.muted}>{u.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
