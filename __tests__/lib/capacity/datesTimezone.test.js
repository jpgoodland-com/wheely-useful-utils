// Run the calendar maths with a far-from-UTC process time zone to prove it never
// depends on local time. TZ must be set before anything creates a Date.
process.env.TZ = "Pacific/Auckland";

const { isoWeekday, addDays, eachDay, fromEpochDay, toEpochDay } = require("@/lib/capacity/dates");
const { sprintsInRange } = require("@/lib/capacity/sprints");

describe("lib/capacity/dates under a non-UTC process time zone", () => {
  it("gives the same answers as in UTC", () => {
    expect(isoWeekday("2026-04-05")).toBe(7); // NZ DST ends this day
    expect(addDays("2026-09-26", 1)).toBe("2026-09-27"); // NZ DST starts the next day
    expect(eachDay("2026-04-04", "2026-04-06")).toHaveLength(3);
    expect(fromEpochDay(toEpochDay("2026-09-27"))).toBe("2026-09-27");
  });

  it("generates Sprint boundaries across DST changes", () => {
    const cfg = { cadenceStart: "2026-03-30", sprintWeeks: 2, sprintNames: {} };
    const s = sprintsInRange(cfg, "2026-03-30", "2026-04-26");
    expect(s.map((x) => [x.start, x.end])).toEqual([
      ["2026-03-30", "2026-04-12"],
      ["2026-04-13", "2026-04-26"],
    ]);
  });
});
