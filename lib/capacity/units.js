// Availability is stored as a fraction of a working day; units are display only.

export const UNITS = ["days", "hours", "points"];

export const UNIT_LABELS = {
  days: { name: "Days", short: "d" },
  hours: { name: "Hours", short: "h" },
  points: { name: "Story points", short: "pts" },
};

export const DAY_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

export function unitsPerDay(cfg) {
  if (cfg.unit === "hours") return cfg.hoursPerDay;
  if (cfg.unit === "points") return cfg.pointsPerDay;
  return 1;
}

export const daysToUnits = (days, cfg) => days * unitsPerDay(cfg);
export const unitsToDays = (units, cfg) => units / unitsPerDay(cfg);

/** Rounded to at most 2 decimals with trailing zeros trimmed. */
export function formatQty(n) {
  const v = Math.round(n * 100) / 100;
  return String(Object.is(v, -0) ? 0 : v);
}

export const formatUnits = (days, cfg) => `${formatQty(daysToUnits(days, cfg))} ${UNIT_LABELS[cfg.unit].short}`;

/** The selectable per-day values, in display units. */
export const stepOptions = (cfg) =>
  DAY_FRACTIONS.map((fraction) => ({ fraction, label: formatQty(daysToUnits(fraction, cfg)) }));
