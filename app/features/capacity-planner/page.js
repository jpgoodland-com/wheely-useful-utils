"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Layers, Plus } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { MAX_AGGREGATE_PLANS } from "@/lib/capacity/constants";
import { UNIT_LABELS } from "@/lib/capacity/units";
import { formatDate } from "@/lib/capacity/dates";
import { api } from "@/components/capacity/api";
import { PlanFormModal } from "@/components/capacity/PlanFormModal";
import { RoleBadge } from "@/components/capacity/PlanConfigPanel";
import styles from "@/components/capacity/Capacity.module.css";

function PlanList({ title, plans, selected, onToggle, emptyText }) {
  return (
    <section className={styles.section} aria-labelledby={`h-${title}`}>
      <h3 id={`h-${title}`}>{title}</h3>
      {plans.length === 0 ? (
        <p className={styles.hint}>{emptyText}</p>
      ) : (
        <ul className={styles.list}>
          {plans.map((p) => (
            <li key={p.planId} className={styles.planCard}>
              <input
                type="checkbox"
                checked={selected.includes(p.planId)}
                onChange={() => onToggle(p.planId)}
                aria-label={`Include ${p.name} in the combined view`}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link href={`/features/capacity-planner/${p.planId}`}>{p.name}</Link>
                <div className={styles.planMeta}>
                  {p.memberCount} {p.memberCount === 1 ? "member" : "members"} · {UNIT_LABELS[p.unit].name} · {p.sprintWeeks}-week Sprints from{" "}
                  {formatDate(p.cadenceStart, { dateStyle: "medium" })} · {p.timeZone}
                </div>
              </div>
              <RoleBadge role={p.role} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function CapacityPlannerPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const load = useCallback(async () => {
    const res = await api("/api/capacity-plans");
    if (res.ok) setPlans(res.data);
    else setError(res.error);
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (loading || !user) return null;

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const atLimit = plans && plans.ownedCount >= plans.maxOwned;
  const tooMany = selected.length > MAX_AGGREGATE_PLANS;

  return (
    <div>
      <nav className="breadcrumb">
        <Link href="/dashboard">Dashboard</Link>
        <ChevronRight size={14} className="separator" />
        <span>Team Capacity Planner</span>
      </nav>

      <div className="page-header">
        <div>
          <h2>Team Capacity Planner</h2>
          <p style={{ fontSize: "0.95rem" }}>Plan each team member&rsquo;s availability by Sprint, and combine teams to see capacity across them.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            href={`/features/capacity-planner/aggregate?ids=${selected.join(",")}`}
            className={`btn btn-outline ${styles.btnSm}`}
            aria-disabled={selected.length < 1 || tooMany}
            onClick={(e) => {
              if (selected.length < 1 || tooMany) e.preventDefault();
            }}
            style={selected.length < 1 || tooMany ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
          >
            <Layers size={16} /> View combined ({selected.length})
          </Link>
          <button type="button" className={`btn btn-primary ${styles.btnSm}`} onClick={() => setCreating(true)} disabled={!plans || atLimit}>
            <Plus size={16} /> New plan
          </button>
        </div>
      </div>

      {error && (
        <div className={`${styles.notice} ${styles.error}`} role="alert">
          {error}
        </div>
      )}
      {tooMany && (
        <div className={`${styles.notice} ${styles.warning}`} role="status">
          You can combine up to {MAX_AGGREGATE_PLANS} plans at once.
        </div>
      )}

      <div className="glass-panel" style={{ padding: "1.5rem" }}>
        {!plans ? (
          <p className={styles.empty}>Loading plans…</p>
        ) : (
          <>
            <PlanList
              title={`My plans (${plans.ownedCount} of ${plans.maxOwned})`}
              plans={plans.owned}
              selected={selected}
              onToggle={toggle}
              emptyText="You don't own any plans yet. Create one to get started."
            />
            {atLimit && <p className={styles.hint} style={{ marginTop: "-1rem", marginBottom: "1.5rem" }}>You&rsquo;ve reached the limit of {plans.maxOwned} plans. Delete or transfer one to create another.</p>}
            <PlanList title="Plans I can edit" plans={plans.editable} selected={selected} onToggle={toggle} emptyText="No one has shared a plan with you for editing." />
            <PlanList title="Read-only plans" plans={plans.readOnly} selected={selected} onToggle={toggle} emptyText="No one has shared a plan with you as read only." />
            <p className={styles.hint}>Tick plans and choose &ldquo;View combined&rdquo; to see capacity across teams.</p>
          </>
        )}
      </div>

      {creating && (
        <PlanFormModal
          currentUser={user}
          onClose={() => setCreating(false)}
          onCreated={(view) => router.push(`/features/capacity-planner/${view.plan.planId}`)}
        />
      )}
    </div>
  );
}
