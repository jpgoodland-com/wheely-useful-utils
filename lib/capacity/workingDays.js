import { eachDay, isoWeekday, toEpochDay } from "./dates";

export const isWorkingDay = (cfg, date) => cfg.workingDays.includes(isoWeekday(date));

/** Working days in [from, to], ignoring anything before the plan's cadence start. */
export function workingDaysInRange(cfg, from, to) {
  const start = toEpochDay(from) < toEpochDay(cfg.cadenceStart) ? cfg.cadenceStart : from;
  if (toEpochDay(start) > toEpochDay(to)) return [];
  return eachDay(start, to).filter((d) => isWorkingDay(cfg, d));
}

export const workingDaysInSprint = (cfg, sprint) => workingDaysInRange(cfg, sprint.start, sprint.end);
