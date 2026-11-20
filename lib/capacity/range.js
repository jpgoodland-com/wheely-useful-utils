import { addDays, isDateStr, toEpochDay } from "./dates";
import { getSprint, sprintIndexForDate } from "./sprints";
import { MAX_RANGE_DAYS } from "./constants";

export const RANGE_PRESETS = [
  { id: "3m", label: "3 months", days: 91 },
  { id: "6m", label: "6 months", days: 182 },
  { id: "52w", label: "52 weeks", days: MAX_RANGE_DAYS },
];

/** Orders the range and limits it to 52 weeks. Returns { from, to, clamped }. */
export function clampRange(from, to) {
  if (toEpochDay(to) < toEpochDay(from)) [from, to] = [to, from];
  const maxTo = addDays(from, MAX_RANGE_DAYS - 1);
  if (toEpochDay(to) > toEpochDay(maxTo)) return { from, to: maxTo, clamped: true };
  return { from, to, clamped: false };
}

/** Roughly 12 weeks from the start of the Sprint containing `today`. */
export function defaultRange(cfg, today) {
  const index = Math.max(0, sprintIndexForDate(cfg, today));
  const count = Math.max(1, Math.ceil(12 / cfg.sprintWeeks));
  const from = getSprint(cfg, index).start;
  return clampRange(from, getSprint(cfg, index + count - 1).end);
}

/** Reads ?from=&to= search params, falling back to the default range. */
export function rangeFromParams(cfg, today, from, to) {
  if (isDateStr(from) && isDateStr(to)) return clampRange(from, to);
  return defaultRange(cfg, today);
}
