import { workingDaysInRange, workingDaysInSprint } from "./workingDays";

/** Availability for a date as a fraction of a day; missing means full availability. */
export const dayFraction = (avail, date) => (avail && Object.hasOwn(avail, date) ? avail[date] : 1);

export const sumDays = (avail, dates) => dates.reduce((sum, d) => sum + dayFraction(avail, d), 0);

export const memberDaysInSpan = (cfg, avail, start, end) => sumDays(avail, workingDaysInRange(cfg, start, end));

/**
 * Per-member, per-Sprint capacity in days.
 * Returns { rows: [{ memberId, cells, total, adjusted }], columnTotals, grandTotal }.
 */
export function buildPlanGrid(cfg, memberIds, availByMember, sprints) {
  const sprintDays = sprints.map((s) => workingDaysInSprint(cfg, s));
  const columnTotals = sprints.map(() => 0);
  const rows = memberIds.map((memberId) => {
    const avail = availByMember?.[memberId];
    const cells = sprintDays.map((dates) => sumDays(avail, dates));
    const adjusted = sprintDays.map((dates) => dates.some((d) => dayFraction(avail, d) !== 1));
    cells.forEach((v, i) => (columnTotals[i] += v));
    return { memberId, cells, adjusted, total: cells.reduce((a, b) => a + b, 0) };
  });
  return { rows, columnTotals, grandTotal: columnTotals.reduce((a, b) => a + b, 0) };
}
