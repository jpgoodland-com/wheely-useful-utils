import {
  isDateStr,
  toEpochDay,
  fromEpochDay,
  addDays,
  isoWeekday,
  startOfIsoWeek,
  eachDay,
  todayInZone,
  isValidTimeZone,
  formatDate,
} from "@/lib/capacity/dates";

describe("lib/capacity/dates", () => {
  it("round-trips epoch days, including leap days and pre-1970 dates", () => {
    for (const d of ["1970-01-01", "1969-12-31", "2024-02-29", "2026-10-15", "2100-03-01"]) {
      expect(fromEpochDay(toEpochDay(d))).toBe(d);
    }
    expect(toEpochDay("1970-01-02")).toBe(1);
  });

  it("validates date strings strictly", () => {
    expect(isDateStr("2026-02-28")).toBe(true);
    expect(isDateStr("2024-02-29")).toBe(true);
    expect(isDateStr("2026-02-29")).toBe(false);
    expect(isDateStr("2026-02-30")).toBe(false);
    expect(isDateStr("2026-2-3")).toBe(false);
    expect(isDateStr("2026-02-03T00:00:00Z")).toBe(false);
    expect(isDateStr(20260203)).toBe(false);
  });

  it("computes ISO weekdays (Mon=1 … Sun=7)", () => {
    expect(isoWeekday("1970-01-01")).toBe(4); // Thursday
    expect(isoWeekday("1969-12-29")).toBe(1); // Monday
    expect(isoWeekday("2026-10-15")).toBe(4); // Thursday
    expect(isoWeekday("2026-10-18")).toBe(7); // Sunday
    expect(startOfIsoWeek("2026-10-18")).toBe("2026-10-12");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("works out today in the team's time zone, not the server's", () => {
    const instant = new Date("2026-10-15T23:30:00Z");
    expect(todayInZone("UTC", instant)).toBe("2026-10-15");
    expect(todayInZone("Pacific/Auckland", instant)).toBe("2026-10-16");
    expect(todayInZone("America/Los_Angeles", instant)).toBe("2026-10-15");
  });

  it("validates time zones", () => {
    expect(isValidTimeZone("Australia/Sydney")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("<script>")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });

  it("formats calendar dates without shifting them", () => {
    expect(formatDate("2026-10-19")).toBe("Oct 19");
  });
});
