import { csvCell, tableToCsv } from "@/lib/capacity/csv";
import { buildSummaryTable, buildDailyTable, exportFileName } from "@/lib/capacity/exportTable";

const plan = {
  planId: "p1",
  name: "Team A",
  timeZone: "Australia/Sydney",
  unit: "points",
  hoursPerDay: 8,
  pointsPerDay: 2,
  workingDays: [1, 2, 3, 4, 5],
  cadenceStart: "2026-10-05",
  sprintWeeks: 1,
  sprintNames: { "2026-10-12": "=HYPERLINK(\"x\")" },
  memberIds: ["a", "b"],
};
const members = { a: { fullName: "Ann Lee" }, b: { fullName: "@Bob" } };
const args = { plan, members, availability: { a: { "2026-10-05": 0.5 } }, from: "2026-10-05", to: "2026-10-18", exportedAt: "2026-10-15T00:00:00.000Z" };

describe("csv", () => {
  it("quotes and escapes per RFC 4180", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell(2.5)).toBe("2.5");
    expect(csvCell(null)).toBe("");
  });

  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tx"])("neutralizes formula-like text %j", (s) => {
    expect(csvCell(s).replace(/^"/, "").startsWith("'")).toBe(true);
  });
});

describe("export tables", () => {
  it("builds a summary grid in plan units with totals", () => {
    const t = buildSummaryTable(args);
    expect(t.header).toEqual(["Team member", "Sprint 1", '=HYPERLINK("x")', "Total"]);
    expect(t.rows).toEqual([
      ["Ann Lee", 9, 10, 19],
      ["@Bob", 10, 10, 20],
    ]);
    expect(t.totalRow).toEqual(["Team total", 19, 20, 39]);
    expect(t.meta).toContainEqual(["Time zone", "Australia/Sydney"]);
  });

  it("writes CSV with the BOM and injection guard applied", () => {
    const csv = tableToCsv(buildSummaryTable(args));
    expect(csv.startsWith("﻿Plan,Team A\r\n")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'@Bob,10,10,20");
  });

  it("builds one daily row per member per working day", () => {
    const t = buildDailyTable(args);
    expect(t.rows).toHaveLength(20);
    expect(t.rows[0]).toEqual(["Ann Lee", "2026-10-05", "Mon", "Sprint 1", 0.5, 1]);
  });

  it("makes a safe file name", () => {
    expect(exportFileName({ name: "Team/../A \"x\"" }, "2026-10-05", "2026-10-18", "csv")).toBe("TeamA-x_2026-10-05_2026-10-18.csv");
  });
});
