import { sprintIndexForDate, getSprint, sprintsInRange } from "@/lib/capacity/sprints";
import { workingDaysInSprint, workingDaysInRange } from "@/lib/capacity/workingDays";
import { buildPlanGrid } from "@/lib/capacity/totals";
import { daysToUnits, stepOptions, formatQty } from "@/lib/capacity/units";
import { clampRange, defaultRange } from "@/lib/capacity/range";
import { cadencesMatch, buildAggregate, displayAggregate, isoWeeksInRange } from "@/lib/capacity/aggregate";

// 2026-10-05 is a Monday.
const base = {
  planId: "p1",
  name: "Team A",
  unit: "days",
  hoursPerDay: 8,
  pointsPerDay: 2,
  workingDays: [1, 2, 3, 4, 5],
  cadenceStart: "2026-10-05",
  sprintWeeks: 2,
  sprintNames: {},
};

describe("sprints", () => {
  it("finds the Sprint for a date, including boundaries", () => {
    expect(sprintIndexForDate(base, "2026-10-04")).toBe(-1);
    expect(sprintIndexForDate(base, "2026-10-05")).toBe(0);
    expect(sprintIndexForDate(base, "2026-10-18")).toBe(0);
    expect(sprintIndexForDate(base, "2026-10-19")).toBe(1);
  });

  it("names Sprints by number unless renamed by start date", () => {
    const cfg = { ...base, sprintNames: { "2026-10-19": "Hardening" } };
    expect(getSprint(cfg, 0).name).toBe("Sprint 1");
    expect(getSprint(cfg, 1)).toMatchObject({ name: "Hardening", start: "2026-10-19", end: "2026-11-01" });
  });

  it("returns overlapping Sprints and never more than 52 weeks of them", () => {
    expect(sprintsInRange(base, "2026-10-10", "2026-10-20").map((s) => s.index)).toEqual([0, 1]);
    expect(sprintsInRange(base, "2026-01-01", "2026-10-01")).toEqual([]);
    expect(sprintsInRange(base, "2026-10-05", "2028-01-01")).toHaveLength(26);
  });
});

describe("working days and totals", () => {
  it("counts only configured weekdays", () => {
    const sprint = getSprint(base, 0);
    expect(workingDaysInSprint(base, sprint)).toHaveLength(10);
    const sunThu = { ...base, workingDays: [7, 1, 2, 3, 4] };
    expect(workingDaysInSprint(sunThu, sprint)).toHaveLength(10);
    expect(workingDaysInRange({ ...base, workingDays: [1] }, "2026-10-05", "2026-10-18")).toEqual(["2026-10-05", "2026-10-12"]);
  });

  it("defaults to full availability and converts units", () => {
    const sprints = sprintsInRange(base, "2026-10-05", "2026-10-18");
    const grid = buildPlanGrid(base, ["a", "b"], {}, sprints);
    expect(grid.rows[0].cells).toEqual([10]);
    expect(grid.grandTotal).toBe(20);
    expect(daysToUnits(10, { ...base, unit: "hours" })).toBe(80);
    expect(daysToUnits(10, { ...base, unit: "points" })).toBe(20);
  });

  it("applies quarter-day overrides exactly and ignores non-working days", () => {
    const sprints = sprintsInRange(base, "2026-10-05", "2026-11-01");
    const avail = { a: { "2026-10-05": 0.25, "2026-10-06": 0.5, "2026-10-07": 0, "2026-10-10": 0 } };
    const grid = buildPlanGrid(base, ["a", "b"], avail, sprints);
    expect(grid.rows[0].cells).toEqual([7.75, 10]);
    expect(grid.rows[0].adjusted).toEqual([true, false]);
    expect(grid.rows[0].total).toBe(17.75);
    expect(grid.columnTotals).toEqual([17.75, 20]);
    expect(grid.grandTotal).toBe(37.75);
  });

  it("offers 0.25-day steps in display units", () => {
    expect(stepOptions({ ...base, unit: "points" }).map((o) => o.label)).toEqual(["0", "0.5", "1", "1.5", "2"]);
    expect(stepOptions({ ...base, unit: "hours", hoursPerDay: 7.5 }).map((o) => o.label)).toEqual(["0", "1.88", "3.75", "5.63", "7.5"]);
    expect(formatQty(2.5)).toBe("2.5");
  });
});

describe("range", () => {
  it("orders and clamps to 52 weeks", () => {
    expect(clampRange("2026-12-01", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-12-01", clamped: false });
    expect(clampRange("2026-01-01", "2028-01-01")).toEqual({ from: "2026-01-01", to: "2026-12-30", clamped: true });
  });

  it("defaults to about 12 weeks from the current Sprint", () => {
    expect(defaultRange(base, "2026-10-21")).toEqual({ from: "2026-10-19", to: "2027-01-10", clamped: false });
    expect(defaultRange(base, "2026-01-01").from).toBe("2026-10-05");
  });
});

describe("aggregate", () => {
  const b = { ...base, planId: "p2", name: "Team B", unit: "points", cadenceStart: "2026-10-19" };
  const c = { ...base, planId: "p3", name: "Team C", unit: "hours", sprintWeeks: 3 };

  it("detects aligned cadences", () => {
    expect(cadencesMatch([base, b])).toBe(true);
    expect(cadencesMatch([base, { ...b, cadenceStart: "2026-10-12" }])).toBe(false);
    expect(cadencesMatch([base, c])).toBe(false);
  });

  it("aligns by Sprint start date and normalizes to days", () => {
    const agg = buildAggregate(
      [
        { plan: base, memberIds: ["a"], availability: {} },
        { plan: b, memberIds: ["x", "y"], availability: { x: { "2026-10-19": 0 } } },
      ],
      "2026-10-05",
      "2026-11-01"
    );
    expect(agg.mode).toBe("sprint");
    expect(agg.columns.map((col) => col.key)).toEqual(["2026-10-05", "2026-10-19"]);
    expect(agg.rows[1].cellsDays).toEqual([0, 19]); // Team B starts in the second column
    expect(agg.rows[1].cellsNative).toEqual([0, 38]);
    expect(agg.rows[1].cellNames).toEqual([null, "Sprint 1"]);
    expect(agg.footerDays).toEqual([10, 29]);
    expect(agg.grandTotalDays).toBe(39);
  });

  it("falls back to calendar weeks when cadences differ", () => {
    const agg = buildAggregate(
      [
        { plan: base, memberIds: ["a"], availability: {} },
        { plan: { ...c, workingDays: [1, 2, 3] }, memberIds: ["z"], availability: {} },
      ],
      "2026-10-07",
      "2026-10-20"
    );
    expect(agg.mode).toBe("week");
    expect(agg.columns.map((col) => col.start)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(agg.rows[0].cellsDays).toEqual([5, 5, 5]);
    expect(agg.rows[1].cellsDays).toEqual([3, 3, 3]);
    expect(agg.rows[1].totalNative).toBe(72);
  });

  it("caps calendar weeks at 52", () => {
    expect(isoWeeksInRange("2026-01-01", "2026-12-30")).toHaveLength(52);
  });
});

describe("displayAggregate", () => {
  // Team A: days, 1 member. Team B: points (2/day), 1 member. Team H: hours (7.5/day), 1 member.
  const a = { ...base, planId: "a", name: "A" };
  const b = { ...base, planId: "b", name: "B", unit: "points", pointsPerDay: 2 };
  const h = { ...base, planId: "h", name: "H", unit: "hours", hoursPerDay: 7.5 };
  const result = buildAggregate(
    [
      { plan: a, memberIds: ["a1"], availability: { a1: { "2026-10-05": 0.5 } } },
      { plan: b, memberIds: ["b1"], availability: {} },
      { plan: h, memberIds: ["h1"], availability: {} },
    ],
    "2026-10-05",
    "2026-10-18"
  );

  it("normalizes everything to days, keeping source units as secondary values", () => {
    const { rows, footers } = displayAggregate(result, "days");
    expect(rows.map((r) => r.cells)).toEqual([[9.5], [10], [10]]);
    expect(rows[0].secondary).toBeNull();
    expect(rows[1].secondary).toEqual({ unit: "points", cells: [20], total: 20 });
    expect(footers).toEqual([{ unit: "days", label: "All teams (days)", teamCount: 3, cells: [29.5], total: 29.5 }]);
  });

  it("normalizes everything to hours using each plan's hours per day", () => {
    const { rows, footers } = displayAggregate(result, "hours");
    expect(rows.map((r) => r.total)).toEqual([76, 80, 75]);
    expect(rows[2].secondary).toBeNull();
    expect(rows[0].memberRows[0].cells).toEqual([76]);
    expect(footers[0]).toMatchObject({ label: "All teams (hours)", total: 231 });
  });

  it("keeps source units and totals each unit separately", () => {
    const { rows, footers } = displayAggregate(result, "source");
    expect(rows.map((r) => [r.displayUnit, r.total])).toEqual([
      ["days", 9.5],
      ["points", 20],
      ["hours", 75],
    ]);
    expect(rows.every((r) => r.secondary === null)).toBe(true);
    expect(footers.map((f) => [f.label, f.total])).toEqual([
      ["Days total (1 team)", 9.5],
      ["Story points total (1 team)", 20],
      ["Hours total (1 team)", 75],
    ]);
  });

  it("uses a single footer in source units when every team shares a unit", () => {
    const same = buildAggregate(
      [
        { plan: b, memberIds: ["b1"], availability: {} },
        { plan: { ...b, planId: "b2", pointsPerDay: 3 }, memberIds: ["x"], availability: {} },
      ],
      "2026-10-05",
      "2026-10-18"
    );
    expect(displayAggregate(same, "source").footers).toEqual([
      { unit: "points", label: "All teams (story points)", teamCount: 2, cells: [50], total: 50 },
    ]);
  });
});

