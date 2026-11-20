"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AGGREGATE_UNITS, displayAggregate } from "@/lib/capacity/aggregate";
import { UNIT_LABELS, formatQty } from "@/lib/capacity/units";
import styles from "./Capacity.module.css";

const fmt = (n) => formatQty(n);
const shortUnit = (unit) => UNIT_LABELS[unit].short;

/** Segmented control choosing how the combined view shows capacity. */
export function UnitsToggle({ value, onChange }) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label="Show capacity in">
      {AGGREGATE_UNITS.map((u) => (
        <button
          key={u.id}
          type="button"
          role="radio"
          aria-checked={value === u.id}
          className={`${styles.segment} ${value === u.id ? styles.segmentActive : ""}`}
          onClick={() => onChange(u.id)}
        >
          {u.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Teams × columns (Sprints when cadences line up, otherwise calendar weeks),
 * shown in each team's own units, or normalized to days or hours. When a team's
 * values are converted, its original units are shown underneath.
 */
export function AggregateGrid({ result, units = "days" }) {
  const [open, setOpen] = useState({});
  const { columns, mode } = result;

  if (columns.length === 0) return <div className={styles.empty}>No {mode === "sprint" ? "Sprints" : "weeks"} in this date range.</div>;

  const { rows, footers } = displayAggregate(result, units);
  const mixed = units === "source" && footers.length > 1;
  const totalUnitLabel = units === "source" ? (mixed ? "source units" : UNIT_LABELS[footers[0].unit].name.toLowerCase()) : units;

  return (
    <div className={styles.scroller} tabIndex={0} role="region" aria-label="Combined capacity by team">
      <table className={styles.table}>
        <caption className={styles.srOnly}>
          Capacity in {totalUnitLabel} per team per {mode === "sprint" ? "Sprint" : "week"}
        </caption>
        <thead>
          <tr>
            <th scope="col" className={styles.stickyLeft}>
              Team
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                <div className={styles.sprintHead}>
                  <span>{mode === "sprint" ? c.label : c.label.replace("Week of ", "Wk of ")}</span>
                </div>
              </th>
            ))}
            <th scope="col" className={styles.stickyRight}>
              Total
              <span className={styles.native}>{totalUnitLabel}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = !!open[row.planId];
            const unitNote = units === "source" ? UNIT_LABELS[row.unit].name : `${UNIT_LABELS[row.unit].name} plan`;
            return (
              <Fragment key={row.planId}>
                <tr>
                  <th scope="row" className={styles.stickyLeft}>
                    <button
                      type="button"
                      className={styles.disclosure}
                      aria-expanded={expanded}
                      onClick={() => setOpen({ ...open, [row.planId]: !expanded })}
                      aria-label={`${expanded ? "Hide" : "Show"} team members for ${row.name}`}
                    >
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>{" "}
                    <Link href={`/features/capacity-planner/${row.planId}`} style={{ color: "inherit" }}>
                      {row.name}
                    </Link>
                    <span className={styles.native}>{unitNote}</span>
                  </th>
                  {row.cells.map((value, i) => (
                    <td key={columns[i].key} title={row.cellNames?.[i] || undefined}>
                      {fmt(value)}
                      {mixed && ` ${shortUnit(row.displayUnit)}`}
                      {row.secondary && (
                        <span className={styles.native}>
                          {fmt(row.secondary.cells[i])} {shortUnit(row.secondary.unit)}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className={styles.stickyRight}>
                    <strong>
                      {fmt(row.total)}
                      {mixed && ` ${shortUnit(row.displayUnit)}`}
                    </strong>
                    {row.secondary && (
                      <span className={styles.native}>
                        {fmt(row.secondary.total)} {shortUnit(row.secondary.unit)}
                      </span>
                    )}
                  </td>
                </tr>
                {expanded &&
                  row.memberRows.map((m) => (
                    <tr key={`${row.planId}-${m.memberId}`} className={styles.subRow}>
                      <th scope="row" className={styles.stickyLeft}>
                        {m.name || "Former user"}
                      </th>
                      {m.cells.map((value, i) => (
                        <td key={columns[i].key}>{fmt(value)}</td>
                      ))}
                      <td className={styles.stickyRight}>{fmt(m.total)}</td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          {footers.map((f, fi) => (
            // Only the last footer row is pinned to the bottom while scrolling.
            <tr key={f.unit} className={fi < footers.length - 1 ? styles.footerUnpinned : undefined}>
              <th scope="row" className={styles.stickyLeft}>
                {f.label}
              </th>
              {f.cells.map((value, i) => (
                <td key={columns[i].key}>
                  {fmt(value)}
                  {mixed && ` ${shortUnit(f.unit)}`}
                </td>
              ))}
              <td className={styles.stickyRight}>
                {fmt(f.total)}
                {mixed && ` ${shortUnit(f.unit)}`}
              </td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}
