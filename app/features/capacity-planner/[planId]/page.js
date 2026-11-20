"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Globe, Settings } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { browserTimeZone, todayInZone } from "@/lib/capacity/dates";
import { rangeFromParams } from "@/lib/capacity/range";
import { sprintsInRange } from "@/lib/capacity/sprints";
import { UNIT_LABELS, unitsPerDay, formatQty } from "@/lib/capacity/units";
import { api, planUrl } from "@/components/capacity/api";
import { CapacityGrid } from "@/components/capacity/CapacityGrid";
import { DayEditorDialog } from "@/components/capacity/DayEditorDialog";
import { ExportMenu } from "@/components/capacity/ExportMenu";
import { PlanConfigPanel, RoleBadge } from "@/components/capacity/PlanConfigPanel";
import { RangeSelector } from "@/components/capacity/RangeSelector";
import { RangePulseFrame, RangeSummary, useRangePulse } from "@/components/capacity/RangeFeedback";
import styles from "@/components/capacity/Capacity.module.css";

function PlanPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { planId } = useParams();
  const { user, loading } = useAuth();

  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [editing, setEditing] = useState(null); // { memberId, sprint }
  const [viewerZone, setViewerZone] = useState(null);
  const pulse = useRangePulse();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const load = useCallback(async () => {
    const res = await api(planUrl(planId));
    if (res.ok) {
      setView(res.data);
      setError("");
    } else {
      setError(res.status === 404 ? "This plan doesn't exist or isn't shared with you." : res.error);
    }
  }, [planId]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  useEffect(() => {
    setViewerZone(browserTimeZone());
  }, []);

  const plan = view?.plan;
  const today = plan ? todayInZone(plan.timeZone) : null;
  const range = plan ? rangeFromParams(plan, today, searchParams.get("from"), searchParams.get("to")) : null;
  const sprints = plan ? sprintsInRange(plan, range.from, range.to) : [];

  if (loading || !user) return null;

  const setRange = ({ from, to }) => {
    router.replace(`${pathname}?${new URLSearchParams({ from, to })}`, { scroll: false });
    pulse.trigger();
  };

  const renameSprint = async (sprint, name) => {
    const res = await api(planUrl(planId, "/sprint-names"), { method: "PUT", body: { names: { [sprint.start]: name } } });
    if (!res.ok) return setError(res.error);
    setView((v) => ({ ...v, plan: { ...v.plan, sprintNames: res.data.sprintNames, version: res.data.version } }));
  };

  const breadcrumb = (
    <nav className="breadcrumb">
      <Link href="/dashboard">Dashboard</Link>
      <ChevronRight size={14} className="separator" />
      <Link href="/features/capacity-planner">Team Capacity Planner</Link>
      <ChevronRight size={14} className="separator" />
      <span>{plan?.name || "Plan"}</span>
    </nav>
  );

  if (!view) {
    return (
      <div>
        {breadcrumb}
        {error ? (
          <div className={`${styles.notice} ${styles.error}`} role="alert">
            {error}
          </div>
        ) : (
          <p className={styles.empty}>Loading plan…</p>
        )}
      </div>
    );
  }

  const unit = UNIT_LABELS[plan.unit];
  const canEdit = view.role !== "view";
  const editingMember = editing && view.members.find((m) => m.userId === editing.memberId);

  return (
    <div>
      {breadcrumb}

      <div className="page-header">
        <div>
          <h2 style={{ marginBottom: "0.25rem" }}>{plan.name}</h2>
          <div className={styles.badges}>
            <RoleBadge role={view.role} />
            <span className={styles.badge}>
              {unit.name}
              {plan.unit !== "days" && ` · 1 day = ${formatQty(unitsPerDay(plan))} ${unit.short}`}
            </span>
            <span className={styles.badge}>{plan.sprintWeeks}-week Sprints</span>
            <span className={styles.badge}>
              <Globe size={12} /> {plan.timeZone}
            </span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <ExportMenu planId={planId} from={range.from} to={range.to} />
          <button type="button" className={`btn btn-outline ${styles.btnSm}`} onClick={() => setConfigOpen(true)}>
            <Settings size={16} /> Configure
          </button>
        </div>
      </div>

      {error && (
        <div className={`${styles.notice} ${styles.error}`} role="alert">
          {error}
        </div>
      )}
      {viewerZone && viewerZone !== plan.timeZone && (
        <div className={styles.notice}>
          <Globe size={16} /> Dates follow the team&rsquo;s time zone ({plan.timeZone}). Yours is {viewerZone}.
        </div>
      )}

      <div className="glass-panel" style={{ padding: "1.25rem" }}>
        <div className={styles.toolbar}>
          <RangeSelector from={range.from} to={range.to} onChange={setRange} />
          <RangeSummary columns={sprints} noun="Sprint" pulse={pulse} />
        </div>
        {canEdit && (
          <p className={styles.hint} style={{ marginBottom: "0.75rem" }}>
            Select a cell to adjust that person&rsquo;s days. Adjusted cells are marked •
          </p>
        )}
        <RangePulseFrame pulse={pulse}>
          <CapacityGrid
            plan={plan}
            members={view.members}
            availability={view.availability}
            sprints={sprints}
            canEdit={canEdit}
            today={today}
            onCellClick={(memberId, sprint) => setEditing({ memberId, sprint })}
            onRename={renameSprint}
          />
        </RangePulseFrame>
      </div>

      {editing && editingMember && (
        <DayEditorDialog
          plan={plan}
          member={editingMember}
          sprint={editing.sprint}
          days={view.availability[editing.memberId]}
          onClose={() => setEditing(null)}
          onSaved={(memberId, days) => {
            setView((v) => ({ ...v, availability: { ...v.availability, [memberId]: days } }));
            setEditing(null);
          }}
        />
      )}

      {configOpen && (
        <PlanConfigPanel
          view={view}
          onChange={setView}
          onClose={() => setConfigOpen(false)}
          onDeleted={() => router.push("/features/capacity-planner")}
          onLeft={() => router.push("/features/capacity-planner")}
        />
      )}
    </div>
  );
}

export default function CapacityPlanPage() {
  return (
    <Suspense fallback={<p className={styles.empty}>Loading plan…</p>}>
      <PlanPage />
    </Suspense>
  );
}
