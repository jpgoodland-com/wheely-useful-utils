import { addDays, diffDays, formatDate, startOfIsoWeek, toEpochDay } from "./dates";
import { sprintIndexForDate, sprintLengthDays, sprintsInRange, getSprint } from "./sprints";
import { memberDaysInSpan } from "./totals";
import { UNIT_LABELS, daysToUnits, unitsPerDay } from "./units";
import { DEFAULT_PLAN, MAX_RANGE_DAYS } from "./constants";

/** True when every plan has the same Sprint length and boundaries that line up. */
export function cadencesMatch(cfgs) {
  if (cfgs.length === 0) return false;
  const len = sprintLengthDays(cfgs[0]);
  return cfgs.every((c) => {
    if (sprintLengthDays(c) !== len) return false;
    const offset = diffDays(cfgs[0].cadenceStart, c.cadenceStart);
    return ((offset % len) + len) % len === 0;
  });
}

/** Monday-start weeks overlapping [from, to], at most 52. */
export function isoWeeksInRange(from, to) {
  const out = [];
  const maxWeeks = MAX_RANGE_DAYS / 7;
  for (let start = startOfIsoWeek(from); toEpochDay(start) <= toEpochDay(to) && out.length < maxWeeks; start = addDays(start, 7)) {
    out.push({ key: start, start, end: addDays(start, 6), label: `Week of ${formatDate(start)}` });
  }
  return out;
}

const spanLabel = (start, end) => `${formatDate(start)} – ${formatDate(end)}`;

/**
 * Combine several plans into one grid. Each entry is { plan, memberIds, availability }.
 * Totals are normalized to days; each team's native units are reported alongside.
 */
export function buildAggregate(entries, from, to) {
  const cfgs = entries.map((e) => e.plan);
  const mode = cadencesMatch(cfgs) ? "sprint" : "week";

  let columns;
  if (mode === "sprint") {
    // Use the earliest cadence start as the reference; all plans share its boundaries.
    const ref = cfgs.reduce((a, b) => (toEpochDay(b.cadenceStart) < toEpochDay(a.cadenceStart) ? b : a));
    columns = sprintsInRange({ ...ref, sprintNames: {} }, from, to).map((s) => ({
      key: s.start,
      start: s.start,
      end: s.end,
      label: spanLabel(s.start, s.end),
    }));
  } else {
    columns = isoWeeksInRange(from, to);
  }

  const footerDays = columns.map(() => 0);
  const rows = entries.map(({ plan, memberIds, availability, members }) => {
    const memberRows = memberIds.map((memberId) => {
      const cellsDays = columns.map((c) => memberDaysInSpan(plan, availability?.[memberId], c.start, c.end));
      return { memberId, name: members?.[memberId]?.fullName, cellsDays, totalDays: cellsDays.reduce((a, b) => a + b, 0) };
    });
    const cellsDays = columns.map((_, i) => memberRows.reduce((sum, r) => sum + r.cellsDays[i], 0));
    cellsDays.forEach((v, i) => (footerDays[i] += v));
    const totalDays = cellsDays.reduce((a, b) => a + b, 0);
    const cellNames =
      mode === "sprint"
        ? columns.map((c) => (sprintIndexForDate(plan, c.start) >= 0 ? getSprint(plan, sprintIndexForDate(plan, c.start)).name : null))
        : null;
    return {
      planId: plan.planId,
      name: plan.name,
      unit: plan.unit,
      unitsPerDay: unitsPerDay(plan),
      // Plans not measured in hours keep the default (8) unless it was changed.
      hoursPerDay: plan.hoursPerDay || DEFAULT_PLAN.hoursPerDay,
      cellsDays,
      cellsNative: cellsDays.map((d) => daysToUnits(d, plan)),
      totalDays,
      totalNative: daysToUnits(totalDays, plan),
      cellNames,
      memberRows,
    };
  });

  return { mode, columns, rows, footerDays, grandTotalDays: footerDays.reduce((a, b) => a + b, 0) };
}

/** Ways the combined view can show capacity. */
export const AGGREGATE_UNITS = [
  { id: "source", label: "Source units" },
  { id: "days", label: "Days" },
  { id: "hours", label: "Hours" },
];

const sum = (values) => values.reduce((a, b) => a + b, 0);

/**
 * Convert an aggregate (built in days) for display.
 *   "days"   — every team in days; one footer total.
 *   "hours"  — every team in hours, using each plan's hours per day; one footer total.
 *   "source" — each team in its own units. Different units can't be added up,
 *              so there is one footer total per unit.
 * Each row also carries its source-unit values as `secondary` when they differ
 * from what's displayed, so the original numbers stay visible.
 */
export function displayAggregate(result, units) {
  const factorFor = (row) => (units === "hours" ? row.hoursPerDay : units === "source" ? row.unitsPerDay : 1);
  const unitFor = (row) => (units === "source" ? row.unit : units);
  const convert = (days, factor) => days.map((d) => d * factor);

  const rows = result.rows.map((row) => {
    const factor = factorFor(row);
    const unit = unitFor(row);
    const cells = convert(row.cellsDays, factor);
    return {
      ...row,
      displayUnit: unit,
      cells,
      total: sum(cells),
      secondary: unit === row.unit ? null : { unit: row.unit, cells: row.cellsNative, total: row.totalNative },
      memberRows: row.memberRows.map((m) => {
        const memberCells = convert(m.cellsDays, factor);
        return { ...m, cells: memberCells, total: sum(memberCells) };
      }),
    };
  });

  const footerUnits = units === "source" ? [...new Set(rows.map((r) => r.displayUnit))] : [units];
  const footers = footerUnits.map((unit) => {
    const teamRows = rows.filter((r) => r.displayUnit === unit);
    const cells = result.columns.map((_, i) => sum(teamRows.map((r) => r.cells[i])));
    const n = teamRows.length;
    const label =
      footerUnits.length === 1
        ? `All teams (${UNIT_LABELS[unit].name.toLowerCase()})`
        : `${UNIT_LABELS[unit].name} total (${n} ${n === 1 ? "team" : "teams"})`;
    return { unit, label, teamCount: n, cells, total: sum(cells) };
  });

  return { rows, footers };
}

