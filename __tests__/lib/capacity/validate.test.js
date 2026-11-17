import {
  normalizePlanConfig,
  normalizeAvailabilityPatch,
  normalizeSprintNamesPatch,
  normalizeAccessChange,
  normalizeDeletionDecisions,
  normalizeExportQuery,
  parsePlanIds,
  CapacityError,
} from "@/lib/capacity/validate";

const ID = "4f9c2a7e-1b3d-4c5e-8f6a-0b1c2d3e4f5a";
const cfg = { cadenceStart: "2026-10-05", workingDays: [1, 2, 3, 4, 5] };

describe("normalizePlanConfig", () => {
  const valid = { name: " Team A ", timeZone: "Australia/Sydney", cadenceStart: "2026-10-05" };

  it("fills defaults and copies only known fields", () => {
    const out = normalizePlanConfig({ ...valid, evil: 1, isAdmin: true });
    expect(out).toEqual({
      name: "Team A",
      timeZone: "Australia/Sydney",
      unit: "days",
      hoursPerDay: 8,
      pointsPerDay: 2,
      workingDays: [1, 2, 3, 4, 5],
      cadenceStart: "2026-10-05",
      sprintWeeks: 2,
    });
  });

  it("sorts and de-duplicates working days", () => {
    expect(normalizePlanConfig({ ...valid, workingDays: [7, 1, 1, 4] }).workingDays).toEqual([1, 4, 7]);
  });

  it.each([
    [{ name: "" }],
    [{ name: "<b>x</b>" }],
    [{ timeZone: "Mars/Olympus" }],
    [{ unit: "weeks" }],
    [{ pointsPerDay: 0.3 }],
    [{ hoursPerDay: 0 }],
    [{ workingDays: [] }],
    [{ workingDays: [0, 8] }],
    [{ cadenceStart: "2026-02-30" }],
    [{ sprintWeeks: 9 }],
    [{ sprintWeeks: 1.5 }],
  ])("rejects %j", (patch) => {
    expect(() => normalizePlanConfig({ ...valid, ...patch })).toThrow(CapacityError);
  });

  it("rejects prototype-polluting payloads", () => {
    expect(() => normalizePlanConfig(JSON.parse('{"__proto__": {"x": 1}}'))).toThrow(CapacityError);
  });

  it("supports partial updates", () => {
    expect(normalizePlanConfig({ unit: "points" }, { partial: true })).toEqual({ unit: "points" });
    expect(() => normalizePlanConfig({}, { partial: true })).toThrow("Nothing to update");
  });
});

describe("normalizeAvailabilityPatch", () => {
  it("accepts quarter-day values on working days", () => {
    expect(normalizeAvailabilityPatch({ memberId: ID, days: { "2026-10-05": 0.75, "2026-10-06": 1 } }, cfg)).toEqual({
      memberId: ID,
      days: { "2026-10-05": 0.75, "2026-10-06": 1 },
    });
  });

  it.each([
    [{ "2026-10-05": 0.3 }],
    [{ "2026-10-05": 1.25 }],
    [{ "2026-10-05": -0.25 }],
    [{ "2026-10-05": "1" }],
    [{ "2026-10-10": 0.5 }], // Saturday
    [{ "2026-10-02": 0.5 }], // before the cadence start
    [{}],
  ])("rejects %j", (days) => {
    expect(() => normalizeAvailabilityPatch({ memberId: ID, days }, cfg)).toThrow(CapacityError);
  });

  it("rejects bad member ids", () => {
    expect(() => normalizeAvailabilityPatch({ memberId: "x", days: { "2026-10-05": 1 } }, cfg)).toThrow(CapacityError);
  });
});

describe("other validators", () => {
  it("normalizes Sprint names, treating empty as a reset", () => {
    expect(normalizeSprintNamesPatch({ "2026-10-05": " Kickoff ", "2026-10-19": "" })).toEqual({
      "2026-10-05": "Kickoff",
      "2026-10-19": null,
    });
    expect(() => normalizeSprintNamesPatch({ "3": "x" })).toThrow(CapacityError);
  });

  it("validates access changes", () => {
    expect(normalizeAccessChange({ identifier: "bob@example.com", role: "view" })).toEqual({ identifier: "bob@example.com", role: "view" });
    expect(() => normalizeAccessChange({ userId: ID, role: "owner" })).toThrow(CapacityError);
  });

  it("validates deletion decisions", () => {
    expect(normalizeDeletionDecisions(undefined)).toEqual({});
    expect(normalizeDeletionDecisions({ [ID]: { action: "transfer", newOwnerId: ID, extra: 1 } })).toEqual({
      [ID]: { action: "transfer", newOwnerId: ID },
    });
    expect(() => normalizeDeletionDecisions({ [ID]: { action: "keep" } })).toThrow(CapacityError);
  });

  it("validates export queries and clamps the range", () => {
    const q = normalizeExportQuery(new URLSearchParams("format=xlsx&view=daily&from=2026-01-01&to=2028-01-01"));
    expect(q).toEqual({ format: "xlsx", view: "daily", from: "2026-01-01", to: "2026-12-30", clamped: true });
    expect(() => normalizeExportQuery(new URLSearchParams("format=pdf&from=2026-01-01&to=2026-02-01"))).toThrow(CapacityError);
  });

  it("parses plan id lists", () => {
    expect(parsePlanIds(`${ID},${ID}`, 10)).toEqual([ID]);
    expect(() => parsePlanIds("nope", 10)).toThrow(CapacityError);
  });
});
