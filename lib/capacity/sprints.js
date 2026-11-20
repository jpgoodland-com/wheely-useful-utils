import { addDays, diffDays, toEpochDay } from "./dates";
import { MAX_RANGE_DAYS } from "./constants";

export const sprintLengthDays = (cfg) => 7 * cfg.sprintWeeks;

/** 0-based Sprint index containing `date`, or -1 before the cadence starts. */
export function sprintIndexForDate(cfg, date) {
  const d = diffDays(cfg.cadenceStart, date);
  if (d < 0) return -1;
  return Math.floor(d / sprintLengthDays(cfg));
}

/** Custom names are keyed by the Sprint's start date so they survive cadence edits. */
export function getSprint(cfg, index) {
  const len = sprintLengthDays(cfg);
  const start = addDays(cfg.cadenceStart, index * len);
  const end = addDays(start, len - 1);
  const defaultName = `Sprint ${index + 1}`;
  const names = cfg.sprintNames || {};
  const name = Object.hasOwn(names, start) ? names[start] : defaultName;
  return { index, start, end, defaultName, name };
}

/** Sprints overlapping [from, to], trimmed so they span at most 52 weeks. */
export function sprintsInRange(cfg, from, to) {
  if (toEpochDay(to) < toEpochDay(cfg.cadenceStart)) return [];
  const first = Math.max(0, sprintIndexForDate(cfg, from));
  const last = sprintIndexForDate(cfg, to);
  const maxCount = Math.max(1, Math.floor(MAX_RANGE_DAYS / sprintLengthDays(cfg)));
  const out = [];
  for (let i = first; i <= last && out.length < maxCount; i++) out.push(getSprint(cfg, i));
  return out;
}
