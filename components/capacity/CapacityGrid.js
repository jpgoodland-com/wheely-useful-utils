"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { formatDate, toEpochDay } from "@/lib/capacity/dates";
import { buildPlanGrid } from "@/lib/capacity/totals";
import { UNIT_LABELS, daysToUnits, formatQty } from "@/lib/capacity/units";
import { MAX_SPRINT_NAME } from "@/lib/capacity/constants";
import styles from "./Capacity.module.css";

const span = (s) => `${formatDate(s.start)} – ${formatDate(s.end)}`;
const isCurrent = (s, today) => today && toEpochDay(s.start) <= toEpochDay(today) && toEpochDay(today) <= toEpochDay(s.end);

function SprintHeader({ sprint, canEdit, current, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sprint.name);

  const save = async () => {
    const name = draft.trim();
    setEditing(false);
    if (name === sprint.name) return;
    await onRename(sprint, name && name !== sprint.defaultName ? name : null);
  };

  return (
    <th scope="col" className={current ? styles.currentSprint : undefined} aria-current={current ? "date" : undefined}>
      <div className={styles.sprintHead}>
        {editing ? (
          <input
            className={styles.renameInput}
            value={draft}
            maxLength={MAX_SPRINT_NAME}
            aria-label={`Rename ${sprint.name}`}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(sprint.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span className={styles.sprintName}>
            {sprint.name}
            {canEdit && (
              <button
                type="button"
                className={styles.iconBtn}
                aria-label={`Rename ${sprint.name}`}
                onClick={() => {
                  setDraft(sprint.name);
                  setEditing(true);
                }}
              >
                <Pencil size={12} />
              </button>
            )}
          </span>
        )}
        <span className={styles.sprintDates}>{span(sprint)}</span>
      </div>
    </th>
  );
}

/**
 * Members × Sprints capacity grid with a team total footer and a total column
 * for the displayed range. Cells open the day editor for people who can edit.
 */
export function CapacityGrid({ plan, members, availability, sprints, canEdit, today, onCellClick, onRename }) {
  if (members.length === 0) {
    return <div className={styles.empty}>No team members yet. Add people from Configure › Team members.</div>;
  }
  if (sprints.length === 0) {
    return <div className={styles.empty}>No Sprints fall in this date range. Sprint 1 starts on {formatDate(plan.cadenceStart, { dateStyle: "medium" })}.</div>;
  }

  const grid = buildPlanGrid(plan, plan.memberIds, availability, sprints);
  const unit = UNIT_LABELS[plan.unit];
  const fmt = (days) => formatQty(daysToUnits(days, plan));
  const byId = Object.fromEntries(members.map((m) => [m.userId, m]));

  return (
    <div className={styles.scroller} tabIndex={0} role="region" aria-label="Capacity by team member and Sprint">
      <table className={styles.table}>
        <caption className={styles.srOnly}>
          Capacity in {unit.name.toLowerCase()} per team member per Sprint
        </caption>
        <thead>
          <tr>
            <th scope="col" className={styles.stickyLeft}>
              Team member
            </th>
            {sprints.map((s) => (
              <SprintHeader key={s.start} sprint={s} canEdit={canEdit} current={isCurrent(s, today)} onRename={onRename} />
            ))}
            <th scope="col" className={styles.stickyRight}>
              Total
              <span className={styles.native}>{unit.name.toLowerCase()}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => {
            const m = byId[row.memberId] || { fullName: "Former user" };
            return (
              <tr key={row.memberId}>
                <th scope="row" className={styles.stickyLeft} title={m.fullName}>
                  <span className={styles.memberName}>
                    <span>{m.fullName}</span>
                    {m.guest ? <span className={styles.muted}>No account</span> : m.username && <span className={styles.muted}>@{m.username}</span>}
                  </span>
                </th>
                {row.cells.map((days, i) => {
                  const label = `${m.fullName}, ${sprints[i].name}: ${fmt(days)} ${unit.name.toLowerCase()}${row.adjusted[i] ? " (adjusted)" : ""}`;
                  return (
                    <td key={sprints[i].start} className={isCurrent(sprints[i], today) ? styles.currentSprint : undefined}>
                      {canEdit ? (
                        <button type="button" className={`${styles.cellBtn} ${row.adjusted[i] ? styles.adjusted : ""}`} aria-label={`${label}. Edit availability`} onClick={() => onCellClick(row.memberId, sprints[i])}>
                          {fmt(days)}
                        </button>
                      ) : (
                        <span className={row.adjusted[i] ? styles.adjusted : undefined} aria-label={label}>
                          {fmt(days)}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className={styles.stickyRight}>
                  <strong>{fmt(row.total)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={styles.stickyLeft}>
              Team total
            </th>
            {grid.columnTotals.map((days, i) => (
              <td key={sprints[i].start}>{fmt(days)}</td>
            ))}
            <td className={styles.stickyRight}>{fmt(grid.grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
