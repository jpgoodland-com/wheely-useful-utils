export const MAX_OWNED_PLANS = 10;
export const MAX_PLAN_NAME = 60;
export const MAX_SPRINT_NAME = 40;
export const MAX_GUEST_NAME = 60;
export const MAX_MEMBERS = 50;
export const MAX_ACCESS = 100;
export const MAX_AGGREGATE_PLANS = 10;
export const MAX_PATCH_DAYS = 62;
export const MAX_SPRINT_NAME_PATCH = 50;
export const MAX_SPRINT_NAMES = 200;
export const MAX_OVERRIDES_PER_MEMBER = 5000;
export const MAX_IDENTIFIER = 100;

export const SPRINT_WEEKS_MIN = 1;
export const SPRINT_WEEKS_MAX = 8;
export const HOURS_PER_DAY_MIN = 0.5;
export const HOURS_PER_DAY_MAX = 24;
export const POINTS_PER_DAY_MIN = 0.25;
export const POINTS_PER_DAY_MAX = 100;
export const CADENCE_MIN = "2000-01-01";
export const CADENCE_MAX = "2100-12-31";

/** 52 weeks, inclusive of both ends. */
export const MAX_RANGE_DAYS = 364;

export const ACCESS_ROLES = ["edit", "view"];

export const DEFAULT_PLAN = {
  unit: "days",
  hoursPerDay: 8,
  pointsPerDay: 2,
  workingDays: [1, 2, 3, 4, 5],
  sprintWeeks: 2,
};
