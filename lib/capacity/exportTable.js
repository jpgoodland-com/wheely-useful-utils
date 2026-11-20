import { WEEKDAY_LABELS, isoWeekday } from "./dates";
import { sprintsInRange } from "./sprints";
import { buildPlanGrid, dayFraction } from "./totals";
import { workingDaysInSprint } from "./workingDays";
import { UNIT_LABELS, daysToUnits, unitsPerDay } from "./units";

const round2 = (n) => Math.round(n * 100) / 100;

function metaRows(plan, from, to, exportedAt) {
  const unit = UNIT_LABELS[plan.unit].name;
  const conversion = plan.unit === "days" ? unit : `${unit} (1 day = ${unitsPerDay(plan)})`;
  return [
    ["Plan", plan.name],
    ["Units", conversion],
    ["Time zone", plan.timeZone],
    ["Range", `${from} to ${to}`],
    ["Exported at (UTC)", exportedAt],
  ];
}

const memberName = (members, id) => members?.[id]?.fullName || members?.[id]?.username || "Former user";

/** Sprint grid in the plan's units: one row per member plus a team total row. */
export function buildSummaryTable({ plan, members, availability, from, to, exportedAt }) {
  const sprints = sprintsInRange(plan, from, to);
  const grid = buildPlanGrid(plan, plan.memberIds, availability, sprints);
  const u = (days) => round2(daysToUnits(days, plan));
  return {
    meta: metaRows(plan, from, to, exportedAt),
    header: ["Team member", ...sprints.map((s) => s.name), "Total"],
    subheader: ["", ...sprints.map((s) => `${s.start} to ${s.end}`), ""],
    rows: grid.rows.map((r) => [memberName(members, r.memberId), ...r.cells.map(u), u(r.total)]),
    totalRow: ["Team total", ...grid.columnTotals.map(u), u(grid.grandTotal)],
  };
}

/** One row per member per working day. */
export function buildDailyTable({ plan, members, availability, from, to, exportedAt }) {
  const sprints = sprintsInRange(plan, from, to);
  const rows = [];
  for (const memberId of plan.memberIds) {
    for (const sprint of sprints) {
      for (const date of workingDaysInSprint(plan, sprint)) {
        const days = dayFraction(availability?.[memberId], date);
        rows.push([memberName(members, memberId), date, WEEKDAY_LABELS[isoWeekday(date) - 1], sprint.name, days, round2(daysToUnits(days, plan))]);
      }
    }
  }
  return {
    meta: metaRows(plan, from, to, exportedAt),
    header: ["Team member", "Date", "Weekday", "Sprint", "Availability (days)", `Availability (${plan.unit})`],
    rows,
  };
}

export function exportFileName(plan, from, to, ext) {
  const base = plan.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "capacity-plan";
  return `${base}_${from}_${to}.${ext}`;
}
