// Calendar-date helpers. Calendar dates are "YYYY-MM-DD" strings and are
// handled internally as integer epoch days, so no local-time Date (and no DST)
// is ever involved. Timestamps (instants) are always UTC ISO-8601.

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TZ_RE = /^[A-Za-z0-9_+\-/]{1,64}$/;

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const pad = (n, w = 2) => String(n).padStart(w, "0");

export function fromEpochDay(n) {
  const d = new Date(n * DAY_MS);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Assumes a valid date string (see isDateStr). */
export function toEpochDay(s) {
  const m = DATE_RE.exec(s);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS;
}

/** Strict "YYYY-MM-DD" check that also rejects impossible dates like 2026-02-30. */
export function isDateStr(s) {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m || +m[1] < 1000) return false;
  return fromEpochDay(toEpochDay(s)) === s;
}

export const addDays = (s, n) => fromEpochDay(toEpochDay(s) + n);
export const diffDays = (from, to) => toEpochDay(to) - toEpochDay(from);

/** ISO weekday: 1 = Monday … 7 = Sunday. 1970-01-01 (epoch day 0) was a Thursday. */
export function isoWeekday(s) {
  const n = toEpochDay(s);
  return ((((n + 3) % 7) + 7) % 7) + 1;
}

export const startOfIsoWeek = (s) => addDays(s, 1 - isoWeekday(s));

/** Every date from `from` to `to`, inclusive. */
export function eachDay(from, to) {
  const out = [];
  for (let n = toEpochDay(from), end = toEpochDay(to); n <= end; n++) out.push(fromEpochDay(n));
  return out;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== "string" || !TZ_RE.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function listTimeZones() {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The calendar date it currently is in `timeZone`. */
export function todayInZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Format a calendar date for display. Uses UTC so the date never shifts. */
export function formatDate(s, opts = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(toEpochDay(s) * DAY_MS));
}

export const nowUtcIso = () => new Date().toISOString();
