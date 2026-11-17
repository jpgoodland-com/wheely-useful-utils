"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { MAX_OWNED_PLANS } from "@/lib/capacity/constants";
import styles from "./Capacity.module.css";

/**
 * Account deletion: for each owned plan other people can edit, choose a new
 * owner or delete it. Plans nobody else can edit are listed as deleted.
 */
export function TransferOwnershipDialog({ review, busy, error, onCancel, onConfirm }) {
  const [decisions, setDecisions] = useState({});
  const complete = review.needsDecision.every((p) => decisions[p.planId]);

  const choose = (planId, value) =>
    setDecisions({ ...decisions, [planId]: value === "delete" ? { action: "delete" } : { action: "transfer", newOwnerId: value } });
  const current = (planId) => {
    const d = decisions[planId];
    return d ? (d.action === "delete" ? "delete" : d.newOwnerId) : "";
  };

  return (
    <Modal
      title="Before you delete your account"
      subtitle="Some of your capacity plans are shared with people who can edit them."
      onClose={onCancel}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`btn btn-primary ${styles.dangerBtn}`} onClick={() => onConfirm(decisions)} disabled={!complete || busy}>
            {busy ? "Deleting…" : "Delete my account"}
          </button>
        </>
      }
    >
      {error && (
        <div className={`${styles.notice} ${styles.error}`} role="alert">
          {error}
        </div>
      )}
      <p className={styles.hint} style={{ marginBottom: "1rem" }}>
        Transfer a plan to keep it for your team, or delete it for everyone. Each person can own up to {MAX_OWNED_PLANS} plans.
      </p>
      <ul className={styles.list}>
        {review.needsDecision.map((plan) => (
          <li key={plan.planId} className={styles.listItem} style={{ flexWrap: "wrap" }}>
            <label htmlFor={`decision-${plan.planId}`} style={{ color: "var(--text-main)", fontWeight: 600 }}>
              {plan.name}
            </label>
            <select id={`decision-${plan.planId}`} className="form-input" value={current(plan.planId)} onChange={(e) => choose(plan.planId, e.target.value)}>
              <option value="" disabled>
                Choose…
              </option>
              {plan.candidates.map((c) => (
                <option key={c.userId} value={c.userId} disabled={c.atLimit}>
                  Transfer to {c.fullName}
                  {c.atLimit ? ` (already owns ${MAX_OWNED_PLANS})` : ""}
                </option>
              ))}
              <option value="delete">Delete for everyone</option>
            </select>
          </li>
        ))}
      </ul>
      {review.autoDelete.length > 0 && (
        <>
          <h3 style={{ fontSize: "0.95rem", margin: "1.5rem 0 0.5rem" }}>Also deleted</h3>
          <p className={styles.hint}>
            {review.autoDelete.map((p) => p.name).join(", ")} — nobody else can edit {review.autoDelete.length === 1 ? "this plan" : "these plans"}, so{" "}
            {review.autoDelete.length === 1 ? "it is" : "they are"} deleted with your account.
          </p>
        </>
      )}
    </Modal>
  );
}
