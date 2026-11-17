"use client";

import { DEFAULT_PLAN, SPRINT_WEEKS_MAX, SPRINT_WEEKS_MIN } from "@/lib/capacity/constants";
import { WEEKDAY_LABELS, browserTimeZone, isValidTimeZone, todayInZone, startOfIsoWeek } from "@/lib/capacity/dates";
import { UNITS, UNIT_LABELS } from "@/lib/capacity/units";
import { DateField } from "./DateField";
import { TimeZoneSelect } from "./TimeZoneSelect";
import styles from "./Capacity.module.css";

export function defaultSettings() {
  const timeZone = browserTimeZone();
  return {
    name: "",
    timeZone,
    ...DEFAULT_PLAN,
    workingDays: [...DEFAULT_PLAN.workingDays],
    cadenceStart: startOfIsoWeek(todayInZone(timeZone)),
  };
}

export const SETTINGS_KEYS = ["name", "timeZone", "unit", "hoursPerDay", "pointsPerDay", "workingDays", "cadenceStart", "sprintWeeks"];

/** Client-side checks mirroring the server; returns an error message or "". */
export function validateSettings(s) {
  if (!s.name.trim()) return "Give the plan a name";
  if (!isValidTimeZone(s.timeZone)) return "Choose a valid time zone";
  if (s.workingDays.length === 0) return "Choose at least one working day";
  if (!s.cadenceStart) return "Choose when Sprint 1 starts";
  if (s.unit === "hours" && !(s.hoursPerDay > 0)) return "Enter the hours in a working day";
  if (s.unit === "points" && !(s.pointsPerDay > 0)) return "Enter how many story points make a day";
  return "";
}

/** Controlled settings form fields shared by plan creation and configuration. */
export function PlanSettingsFields({ value, onChange, disabled }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });
  const setNumber = (key) => (e) => onChange({ ...value, [key]: e.target.value === "" ? "" : Number(e.target.value) });
  const toggleDay = (d) =>
    onChange({
      ...value,
      workingDays: value.workingDays.includes(d) ? value.workingDays.filter((x) => x !== d) : [...value.workingDays, d].sort((a, b) => a - b),
    });

  return (
    <div className={styles.formGrid}>
      <div className={`form-group ${styles.full}`}>
        <label className="form-label" htmlFor="plan-name">
          Team name
        </label>
        <input id="plan-name" className="form-input" value={value.name} onChange={set("name")} maxLength={60} disabled={disabled} data-autofocus />
      </div>

      <div className={`form-group ${styles.full}`}>
        <label className="form-label" htmlFor="plan-tz">
          Team time zone
        </label>
        <TimeZoneSelect id="plan-tz" value={value.timeZone} onChange={set("timeZone")} disabled={disabled} />
        <span className={styles.hint}>Decides what &ldquo;today&rdquo; and the current Sprint are for the team.</span>
      </div>

      <fieldset className={`${styles.fieldset} ${styles.full}`} disabled={disabled}>
        <legend className="form-label" style={{ marginBottom: "0.5rem" }}>
          Capacity units
        </legend>
        <div className={styles.radioRow}>
          {UNITS.map((u) => (
            <label key={u}>
              <input type="radio" name="plan-unit" value={u} checked={value.unit === u} onChange={set("unit")} />
              {UNIT_LABELS[u].name}
            </label>
          ))}
        </div>
      </fieldset>

      {value.unit === "hours" && (
        <div className={`form-group ${styles.full}`}>
          <label className="form-label" htmlFor="plan-hours">
            Hours in a working day
          </label>
          <input id="plan-hours" className="form-input" type="number" min={0.5} max={24} step={0.25} value={value.hoursPerDay} onChange={setNumber("hoursPerDay")} disabled={disabled} />
        </div>
      )}
      {value.unit === "points" && (
        <div className={`form-group ${styles.full}`}>
          <label className="form-label" htmlFor="plan-points">
            Story points per working day
          </label>
          <input id="plan-points" className="form-input" type="number" min={0.25} max={100} step={0.25} value={value.pointsPerDay} onChange={setNumber("pointsPerDay")} disabled={disabled} />
          <span className={styles.hint}>For example, 2 means 1 working day = 2 story points.</span>
        </div>
      )}

      <fieldset className={`${styles.fieldset} ${styles.full}`} disabled={disabled}>
        <legend className="form-label" style={{ marginBottom: "0.5rem" }}>
          Working days
        </legend>
        <div className={styles.weekdays}>
          {WEEKDAY_LABELS.map((label, i) => {
            const d = i + 1;
            const on = value.workingDays.includes(d);
            return (
              <button key={label} type="button" className={`${styles.chip} ${on ? styles.chipActive : ""}`} aria-pressed={on} onClick={() => toggleDay(d)}>
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="form-group">
        <label className="form-label" htmlFor="plan-start">
          Sprint 1 starts on
        </label>
        <DateField id="plan-start" label="Sprint 1 start date" value={value.cadenceStart} onChange={set("cadenceStart")} disabled={disabled} min="2000-01-01" max="2100-12-31" />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="plan-weeks">
          Weeks per Sprint
        </label>
        <select id="plan-weeks" className="form-input" value={value.sprintWeeks} onChange={setNumber("sprintWeeks")} disabled={disabled}>
          {Array.from({ length: SPRINT_WEEKS_MAX - SPRINT_WEEKS_MIN + 1 }, (_, i) => i + SPRINT_WEEKS_MIN).map((w) => (
            <option key={w} value={w}>
              {w} {w === 1 ? "week" : "weeks"}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
