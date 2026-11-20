"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { WEEKDAY_LABELS, formatDate, isoWeekday, startOfIsoWeek } from "@/lib/capacity/dates";
import { workingDaysInSprint } from "@/lib/capacity/workingDays";
import { dayFraction } from "@/lib/capacity/totals";
import { UNIT_LABELS, daysToUnits, formatQty, stepOptions } from "@/lib/capacity/units";
import { api, planUrl } from "./api";
import styles from "./Capacity.module.css";

/**
 * Per-day availability for one member in one Sprint. Days default to full
 * availability; Accept saves only the days that changed, Discard throws the
 * draft away.
 */
export function DayEditorDialog({ plan, member, sprint, days: savedDays, onClose, onSaved }) {
  const dates = useMemo(() => workingDaysInSprint(plan, sprint), [plan, sprint]);
  const weeks = useMemo(() => {
    const groups = new Map();
    for (const d of dates) {
      const week = startOfIsoWeek(d);
      groups.set(week, [...(groups.get(week) || []), d]);
    }
    return [...groups];
  }, [dates]);
  const original = useMemo(() => Object.fromEntries(dates.map((d) => [d, dayFraction(savedDays, d)])), [dates, savedDays]);
  const [draft, setDraft] = useState(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const options = stepOptions(plan);
  const unit = UNIT_LABELS[plan.unit];
  const total = dates.reduce((sum, d) => sum + draft[d], 0);
  const changes = Object.fromEntries(dates.filter((d) => draft[d] !== original[d]).map((d) => [d, draft[d]]));
  const changeCount = Object.keys(changes).length;

  const setAll = (fraction) => setDraft(Object.fromEntries(dates.map((d) => [d, fraction])));

  const accept = async () => {
    if (changeCount === 0) return onClose();
    setSaving(true);
    setError("");
    const res = await api(planUrl(plan.planId, "/availability"), { method: "PATCH", body: { memberId: member.userId, days: changes } });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onSaved(res.data.memberId, res.data.days);
  };

  return (
    <Modal
      title={`${member.fullName} · ${sprint.name}`}
      subtitle={`${formatDate(sprint.start, { dateStyle: "medium" })} – ${formatDate(sprint.end, { dateStyle: "medium" })} · ${plan.timeZone}`}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            Discard
          </button>
          <button type="button" className="btn btn-primary" onClick={accept} disabled={saving}>
            {saving ? "Saving…" : "Accept"}
          </button>
        </>
      }
    >
      <div className={styles.summaryBar}>
        <div>
          <strong style={{ fontSize: "1.25rem" }}>
            {formatQty(daysToUnits(total, plan))} {unit.name.toLowerCase()}
          </strong>
          <div className={styles.hint}>
            {changeCount === 0 ? "No changes" : `${changeCount} day${changeCount === 1 ? "" : "s"} changed`}
          </div>
        </div>
        <div className={styles.presets}>
          <button type="button" className={styles.chip} onClick={() => setAll(1)}>
            All full
          </button>
          <button type="button" className={styles.chip} onClick={() => setAll(0)}>
            All off
          </button>
        </div>
      </div>

      {error && (
        <div className={`${styles.notice} ${styles.error}`} role="alert">
          {error}
        </div>
      )}

      {dates.length === 0 ? (
        <p className={styles.empty}>There are no working days in this Sprint.</p>
      ) : (
        weeks.map(([week, weekDates]) => (
          <div key={week}>
            <div className={styles.weekLabel}>Week of {formatDate(week)}</div>
            <div className={styles.list}>
              {weekDates.map((d) => (
                <div key={d} className={`${styles.dayRow} ${draft[d] !== original[d] ? styles.dayChanged : ""}`}>
                  <label htmlFor={`day-${d}`}>
                    {WEEKDAY_LABELS[isoWeekday(d) - 1]} {formatDate(d)}
                  </label>
                  <select id={`day-${d}`} className="form-input" value={draft[d]} onChange={(e) => setDraft({ ...draft, [d]: Number(e.target.value) })}>
                    {options.map((o) => (
                      <option key={o.fraction} value={o.fraction}>
                        {o.label} {unit.short}
                        {o.fraction === 1 ? " (full)" : o.fraction === 0 ? " (off)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </Modal>
  );
}
