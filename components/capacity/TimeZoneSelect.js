"use client";

import { useMemo } from "react";
import { listTimeZones } from "@/lib/capacity/dates";

/** "GMT-6" style offset for a zone right now, or "" if the runtime can't format it. */
function offsetLabel(timeZone, now) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName");
    return part ? part.value.replace("GMT", "UTC") : "";
  } catch {
    return "";
  }
}

/** All IANA zones grouped by region ("America", "Europe", …). */
function groupZones(zones, now) {
  const groups = new Map();
  for (const zone of zones) {
    const slash = zone.indexOf("/");
    const region = slash === -1 ? "Other" : zone.slice(0, slash);
    const place = (slash === -1 ? zone : zone.slice(slash + 1)).replace(/_/g, " ").replace(/\//g, " / ");
    const offset = offsetLabel(zone, now);
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region).push({ zone, label: offset ? `${place} (${offset})` : place });
  }
  return [...groups].sort(([a], [b]) => (a === "Other") - (b === "Other") || a.localeCompare(b));
}

/**
 * Native select of every time zone, so the full list is always available
 * (type a letter to jump). The current value is kept even if it is an alias
 * missing from the runtime's canonical list.
 */
export function TimeZoneSelect({ id, value, onChange, disabled }) {
  const groups = useMemo(() => {
    const zones = listTimeZones();
    return groupZones(value && !zones.includes(value) ? [value, ...zones] : zones, new Date());
  }, [value]);

  return (
    <select id={id} className="form-input" value={value} onChange={onChange} disabled={disabled}>
      {groups.map(([region, zones]) => (
        <optgroup key={region} label={region}>
          {zones.map(({ zone, label }) => (
            <option key={zone} value={zone}>
              {label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
