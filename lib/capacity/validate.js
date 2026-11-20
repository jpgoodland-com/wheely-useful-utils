import { isSafePlainObject } from "@/lib/objectGuard";
import { UNSAFE_TEXT_RE } from "@/lib/coinConstants";
import { isDateStr, isValidTimeZone, toEpochDay } from "./dates";
import { isWorkingDay } from "./workingDays";
import { UNITS } from "./units";
import { clampRange } from "./range";
import {
  ACCESS_ROLES,
  CADENCE_MAX,
  CADENCE_MIN,
  DEFAULT_PLAN,
  HOURS_PER_DAY_MAX,
  HOURS_PER_DAY_MIN,
  MAX_GUEST_NAME,
  MAX_IDENTIFIER,
  MAX_PATCH_DAYS,
  MAX_PLAN_NAME,
  MAX_SPRINT_NAME,
  MAX_SPRINT_NAME_PATCH,
  POINTS_PER_DAY_MAX,
  POINTS_PER_DAY_MIN,
  SPRINT_WEEKS_MAX,
  SPRINT_WEEKS_MIN,
} from "./constants";

export class CapacityError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidId = (id) => typeof id === "string" && UUID_RE.test(id);

const isQuarterStep = (x) => typeof x === "number" && Number.isFinite(x) && Number.isInteger(x * 4);

function assertPlainObject(o, what) {
  if (!isSafePlainObject(o)) throw new CapacityError(`${what} is invalid`);
}

function cleanText(value, max, what) {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v || v.length > max || UNSAFE_TEXT_RE.test(v)) {
    throw new CapacityError(`${what} must be 1–${max} characters`);
  }
  return v;
}

function inRange(value, min, max, what) {
  if (!isQuarterStep(value) || value < min || value > max) {
    throw new CapacityError(`${what} must be between ${min} and ${max}, in steps of 0.25`);
  }
  return value;
}

const FIELDS = {
  name: (v) => cleanText(v, MAX_PLAN_NAME, "Plan name"),
  timeZone: (v) => {
    if (!isValidTimeZone(v)) throw new CapacityError("Time zone is invalid");
    return v;
  },
  unit: (v) => {
    if (!UNITS.includes(v)) throw new CapacityError("Unit must be days, hours or points");
    return v;
  },
  hoursPerDay: (v) => inRange(v, HOURS_PER_DAY_MIN, HOURS_PER_DAY_MAX, "Hours per day"),
  pointsPerDay: (v) => inRange(v, POINTS_PER_DAY_MIN, POINTS_PER_DAY_MAX, "Story points per day"),
  workingDays: (v) => {
    if (!Array.isArray(v) || v.length === 0 || v.length > 7 || !v.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) {
      throw new CapacityError("Choose at least one working day");
    }
    return [...new Set(v)].sort((a, b) => a - b);
  },
  cadenceStart: (v) => {
    if (!isDateStr(v) || v < CADENCE_MIN || v > CADENCE_MAX) throw new CapacityError("Sprint start date is invalid");
    return v;
  },
  sprintWeeks: (v) => {
    if (!Number.isInteger(v) || v < SPRINT_WEEKS_MIN || v > SPRINT_WEEKS_MAX) {
      throw new CapacityError(`Sprint length must be ${SPRINT_WEEKS_MIN}–${SPRINT_WEEKS_MAX} weeks`);
    }
    return v;
  },
};

const REQUIRED = ["name", "timeZone", "cadenceStart"];

/**
 * Validate plan settings and copy only known fields. With `partial`, absent
 * fields are left out (for updates); otherwise defaults fill optional fields.
 */
export function normalizePlanConfig(input, { partial = false } = {}) {
  assertPlainObject(input, "Plan settings");
  const out = {};
  for (const [key, check] of Object.entries(FIELDS)) {
    if (input[key] !== undefined) out[key] = check(input[key]);
    else if (!partial && REQUIRED.includes(key)) throw new CapacityError(`${key} is required`);
    else if (!partial && key in DEFAULT_PLAN) out[key] = DEFAULT_PLAN[key];
  }
  if (partial && Object.keys(out).length === 0) throw new CapacityError("Nothing to update");
  return out;
}

/** { "<sprint start date>": "name" | null } — null or "" clears the custom name. */
export function normalizeSprintNamesPatch(input) {
  assertPlainObject(input, "Sprint names");
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.length > MAX_SPRINT_NAME_PATCH) throw new CapacityError("Sprint names are invalid");
  const out = {};
  for (const k of keys) {
    if (!isDateStr(k)) throw new CapacityError("Sprint names are invalid");
    const v = input[k];
    out[k] = v === null || v === "" ? null : cleanText(v, MAX_SPRINT_NAME, "Sprint name");
  }
  return out;
}

/** { memberId, days: { "YYYY-MM-DD": fraction } } checked against the plan. */
export function normalizeAvailabilityPatch(input, cfg) {
  assertPlainObject(input, "Availability");
  if (!isValidId(input.memberId)) throw new CapacityError("Team member is invalid");
  assertPlainObject(input.days, "Availability");
  const dates = Object.keys(input.days);
  if (dates.length === 0 || dates.length > MAX_PATCH_DAYS) throw new CapacityError("Availability is invalid");
  const days = {};
  for (const date of dates) {
    if (!isDateStr(date) || toEpochDay(date) < toEpochDay(cfg.cadenceStart) || !isWorkingDay(cfg, date)) {
      throw new CapacityError(`${date} is not a working day in this plan`);
    }
    const v = input.days[date];
    if (!isQuarterStep(v) || v < 0 || v > 1) throw new CapacityError("Availability must be 0–1 day in 0.25 steps");
    days[date] = v;
  }
  return { memberId: input.memberId, days };
}

/** Display name for a team member who doesn't have an account. */
export const normalizeGuestName = (value) => cleanText(value, MAX_GUEST_NAME, "Name");

/** { userId } or { identifier } (email or username). */
export function normalizeUserRef(input) {
  assertPlainObject(input, "User");
  if (input.userId !== undefined) {
    if (!isValidId(input.userId)) throw new CapacityError("User is invalid");
    return { userId: input.userId };
  }
  return { identifier: cleanText(input.identifier, MAX_IDENTIFIER, "Email or username") };
}

export function normalizeAccessChange(input) {
  const ref = normalizeUserRef(input);
  if (!ACCESS_ROLES.includes(input.role)) throw new CapacityError("Access must be edit or view");
  return { ...ref, role: input.role };
}

/** { [planId]: { action: "transfer", newOwnerId } | { action: "delete" } } */
export function normalizeDeletionDecisions(input) {
  if (input === undefined || input === null) return {};
  assertPlainObject(input, "Plan decisions");
  const out = {};
  const keys = Object.keys(input);
  if (keys.length > 50) throw new CapacityError("Plan decisions are invalid");
  for (const planId of keys) {
    const d = input[planId];
    assertPlainObject(d, "Plan decision");
    if (!isValidId(planId)) throw new CapacityError("Plan decisions are invalid");
    if (d.action === "delete") out[planId] = { action: "delete" };
    else if (d.action === "transfer" && isValidId(d.newOwnerId)) out[planId] = { action: "transfer", newOwnerId: d.newOwnerId };
    else throw new CapacityError("Plan decisions are invalid");
  }
  return out;
}

export function normalizeExportQuery(searchParams) {
  const format = searchParams.get("format") || "csv";
  const view = searchParams.get("view") || "summary";
  if (!["csv", "xlsx"].includes(format)) throw new CapacityError("Format must be csv or xlsx");
  if (!["summary", "daily"].includes(view)) throw new CapacityError("View must be summary or daily");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!isDateStr(from) || !isDateStr(to)) throw new CapacityError("A valid date range is required");
  return { format, view, ...clampRange(from, to) };
}

export function parsePlanIds(raw, max) {
  const ids = [...new Set(String(raw || "").split(",").filter(Boolean))];
  if (ids.length === 0 || ids.length > max || !ids.every(isValidId)) {
    throw new CapacityError(`Select between 1 and ${max} plans`);
  }
  return ids;
}
