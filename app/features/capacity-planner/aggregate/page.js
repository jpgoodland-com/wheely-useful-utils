"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Info } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { addDays, browserTimeZone, isDateStr, startOfIsoWeek, todayInZone } from "@/lib/capacity/dates";
import { clampRange } from "@/lib/capacity/range";
import { AGGREGATE_UNITS, buildAggregate } from "@/lib/capacity/aggregate";
import { api } from "@/components/capacity/api";
import { AggregateGrid, UnitsToggle } from "@/components/capacity/AggregateGrid";
import { RangeSelector } from "@/components/capacity/RangeSelector";
import { RangePulseFrame, RangeSummary, useRangePulse } from "@/components/capacity/RangeFeedback";
import styles from "@/components/capacity/Capacity.module.css";

const UNITS_HINT = {
  source: "Each team in its own units. Teams using different units are totalled separately.",
  days: "All teams converted to days using each plan's conversion. Original units are shown underneath.",
  hours: "All teams converted to hours using each plan's hours per day (8 unless the plan sets otherwise). Original units are shown underneath.",
};

function defaultRange() {
  const from = startOfIsoWeek(todayInZone(browserTimeZone()));
  return { from, to: addDays(from, 12 * 7 - 1) };
}

function AggregateView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const ids = searchParams.get("ids") || "";

  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const pulse = useRangePulse();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const load = useCallback(async () => {
    if (!ids) return setError("Choose at least one plan from the planner.");
    const res = await api(`/api/capacity-plans/aggregate?ids=${encodeURIComponent(ids)}`);
    if (res.ok) setData(res.data);
    else setError(res.error);
  }, [ids]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (loading || !user) return null;

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const range = isDateStr(from) && isDateStr(to) ? clampRange(from, to) : defaultRange();
  const unitsParam = searchParams.get("units");
  const units = AGGREGATE_UNITS.some((u) => u.id === unitsParam) ? unitsParam : "days";
  const replaceQuery = (next) =>
    router.replace(`${pathname}?${new URLSearchParams({ ids, from: range.from, to: range.to, units, ...next })}`, { scroll: false });
  const setRange = (r) => {
    replaceQuery({ from: r.from, to: r.to });
    pulse.trigger();
  };
  const setUnits = (next) => replaceQuery({ units: next });

  const entries = (data?.plans || []).map((v) => ({
    plan: v.plan,
    memberIds: v.plan.memberIds,
    availability: v.availability,
    members: Object.fromEntries(v.members.map((m) => [m.userId, m])),
  }));
  const result = entries.length ? buildAggregate(entries, range.from, range.to) : null;

  return (
    <div>
      <nav className="breadcrumb">
        <Link href="/dashboard">Dashboard</Link>
        <ChevronRight size={14} className="separator" />
        <Link href="/features/capacity-planner">Team Capacity Planner</Link>
        <ChevronRight size={14} className="separator" />
        <span>Combined view</span>
      </nav>

      <div className="page-header">
        <div>
          <h2 style={{ marginBottom: "0.25rem" }}>Combined capacity</h2>
          <p style={{ fontSize: "0.95rem" }}>
            {entries.length} {entries.length === 1 ? "team" : "teams"} · {units === "source" ? "shown in each team's own units" : `totals in ${units}`}
          </p>
        </div>
      </div>

      {error && (
        <div className={`${styles.notice} ${styles.error}`} role="alert">
          {error}
        </div>
      )}
      {data?.inaccessible?.length > 0 && (
        <div className={`${styles.notice} ${styles.warning}`}>
          {data.inaccessible.length} selected {data.inaccessible.length === 1 ? "plan isn't" : "plans aren't"} available to you and {data.inaccessible.length === 1 ? "was" : "were"} left out.
        </div>
      )}
      {result && (
        <div className={styles.notice}>
          <Info size={16} />
          {result.mode === "sprint"
            ? "These teams share the same Sprint cadence, so columns are Sprints."
            : "These teams have different Sprint cadences, so columns are calendar weeks (Monday to Sunday)."}
        </div>
      )}

      <div className="glass-panel" style={{ padding: "1.25rem" }}>
        <div className={styles.toolbar}>
          <RangeSelector from={range.from} to={range.to} onChange={setRange} />
          {result && <RangeSummary columns={result.columns} noun={result.mode === "sprint" ? "Sprint" : "week"} pulse={pulse} />}
        </div>
        {!data && !error && <p className={styles.empty}>Loading plans…</p>}
        {result && (
          <div className={styles.unitsBar}>
            <UnitsToggle value={units} onChange={setUnits} />
            <span className={styles.hint}>{UNITS_HINT[units]}</span>
          </div>
        )}
        {result && (
          <RangePulseFrame pulse={pulse}>
            <AggregateGrid result={result} units={units} />
          </RangePulseFrame>
        )}
      </div>
    </div>
  );
}

export default function AggregatePage() {
  return (
    <Suspense fallback={<p className={styles.empty}>Loading…</p>}>
      <AggregateView />
    </Suspense>
  );
}
