"use client";

import { useState } from "react";
import { Check, Link2, Pencil, Trash2, UserMinus } from "lucide-react";
import { Modal } from "@/components/Modal";
import { MAX_OWNED_PLANS } from "@/lib/capacity/constants";
import { api, planUrl } from "./api";
import { PlanSettingsFields, SETTINGS_KEYS, validateSettings } from "./PlanSettingsFields";
import { UserPicker } from "./UserPicker";
import { GuestMemberInput } from "./GuestMemberInput";
import styles from "./Capacity.module.css";

const ROLE_LABELS = { owner: "Owner", edit: "Can edit", view: "Read only" };
const ROLE_CLASS = { owner: styles.badgeOwner, edit: styles.badgeEdit, view: styles.badgeView };

export function RoleBadge({ role }) {
  return <span className={`${styles.badge} ${ROLE_CLASS[role]}`}>{ROLE_LABELS[role]}</span>;
}

function Person({ person }) {
  return (
    <div className={styles.person}>
      <span>{person.fullName}</span>
      <span className={styles.muted}>{person.guest ? "No account" : person.email || (person.username ? `@${person.username}` : "")}</span>
    </div>
  );
}

function ErrorNotice({ message }) {
  if (!message) return null;
  return (
    <div className={`${styles.notice} ${styles.error}`} role="alert">
      {message}
    </div>
  );
}

function SettingsTab({ view, onChange }) {
  const isOwner = view.role === "owner";
  const [form, setForm] = useState(() => Object.fromEntries(SETTINGS_KEYS.map((k) => [k, view.plan[k]])));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const changed = Object.fromEntries(SETTINGS_KEYS.filter((k) => JSON.stringify(form[k]) !== JSON.stringify(view.plan[k])).map((k) => [k, form[k]]));
  const cadenceChanged = "cadenceStart" in changed || "sprintWeeks" in changed;
  const daysRemoved = view.plan.workingDays.some((d) => !form.workingDays.includes(d));

  const save = async (e) => {
    e.preventDefault();
    const problem = validateSettings(form);
    if (problem) return setError(problem);
    if (Object.keys(changed).length === 0) return;
    setSaving(true);
    setError("");
    setSaved(false);
    const res = await api(planUrl(view.plan.planId), { method: "PATCH", body: { expectedVersion: view.plan.version, settings: changed } });
    setSaving(false);
    if (!res.ok) {
      return setError(res.status === 409 ? "Someone else changed this plan. Close this dialog and reload the page to see their changes." : res.error);
    }
    setSaved(true);
    onChange(res.data);
  };

  return (
    <form onSubmit={save}>
      {!isOwner && <div className={styles.notice}>Only the plan owner can change these settings.</div>}
      <ErrorNotice message={error} />
      {saved && (
        <div className={styles.notice} role="status">
          Settings saved.
        </div>
      )}
      <PlanSettingsFields value={form} onChange={setForm} disabled={!isOwner} />
      {isOwner && cadenceChanged && (
        <div className={`${styles.notice} ${styles.warning}`}>
          Changing the Sprint cadence renumbers Sprints. Custom Sprint names stay only where a Sprint still starts on the same date. Availability is kept by date.
        </div>
      )}
      {isOwner && daysRemoved && (
        <div className={`${styles.notice} ${styles.warning}`}>Adjustments on days that are no longer working days are kept but not counted.</div>
      )}
      {isOwner && (
        <button type="submit" className="btn btn-primary" disabled={saving || Object.keys(changed).length === 0}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      )}
    </form>
  );
}

function MembersTab({ view, onChange }) {
  const canManage = view.role !== "view";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(null); // { userId, name }
  const [linking, setLinking] = useState(null); // member id of the row being linked to an account

  const send = async (path, method, body) => {
    setBusy(true);
    setError("");
    const res = await api(planUrl(view.plan.planId, path), { method, body });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    onChange(res.data);
    return true;
  };

  const add = (choice) => send("/members", "POST", choice.userId ? { userId: choice.userId } : { identifier: choice.identifier });
  const addGuest = (name) => send("/members", "POST", { guestName: name });

  const link = async (guest, choice) => {
    const who = choice.userId ? `${choice.fullName}${choice.email ? ` (${choice.email})` : ""}` : choice.identifier;
    if (!window.confirm(`Link ${guest.fullName} to ${who}? Their row and availability move to that account, and the account gets edit access if it doesn't already have access.`)) return;
    const body = choice.userId ? { userId: choice.userId } : { identifier: choice.identifier };
    if (await send(`/members/${guest.userId}/link`, "POST", body)) setLinking(null);
  };

  const saveRename = async () => {
    const name = renaming.name.trim();
    const current = view.members.find((m) => m.userId === renaming.userId);
    if (!name || name === current?.fullName) return setRenaming(null);
    if (await send(`/members/${renaming.userId}`, "PATCH", { name })) setRenaming(null);
  };

  const remove = async (member) => {
    const accessNote = member.guest ? "" : " Their access to the plan is not changed.";
    if (!window.confirm(`Remove ${member.fullName} from the team? Their availability adjustments in this plan will be deleted.${accessNote}`)) return;
    setBusy(true);
    setError("");
    const res = await api(planUrl(view.plan.planId, `/members/${member.userId}`), { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onChange(res.data);
  };

  return (
    <div>
      <p className={styles.hint} style={{ marginBottom: "1rem" }}>
        Team members are the rows in the grid. Adding someone with an account who doesn&rsquo;t have access gives them edit access so they can enter their
        availability. People without an account don&rsquo;t get access; anyone who can edit the plan fills in their availability.
      </p>
      <ErrorNotice message={error} />
      {view.members.length === 0 ? (
        <p className={styles.empty}>No team members yet.</p>
      ) : (
        <ul className={styles.list}>
          {view.members.map((m) => (
            <li key={m.userId} className={styles.listItem} style={{ flexWrap: "wrap" }}>
              {renaming?.userId === m.userId ? (
                <input
                  className="form-input"
                  style={{ flex: 1, padding: "0.45rem 0.75rem", fontSize: "0.9rem" }}
                  value={renaming.name}
                  maxLength={60}
                  autoFocus
                  aria-label={`New name for ${m.fullName}`}
                  onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveRename();
                    }
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setRenaming(null);
                    }
                  }}
                />
              ) : (
                <Person person={m} />
              )}
              {canManage && (
                <div className={styles.rowActions}>
                  {m.guest && (
                    <button
                      type="button"
                      className={`btn btn-outline ${styles.btnSm}`}
                      onClick={() => setLinking(linking === m.userId ? null : m.userId)}
                      disabled={busy}
                      aria-expanded={linking === m.userId}
                      aria-label={`Link ${m.fullName} to an account`}
                    >
                      <Link2 size={14} /> Link account
                    </button>
                  )}
                  {m.guest &&
                    (renaming?.userId === m.userId ? (
                      <button type="button" className={styles.iconBtn} onClick={saveRename} disabled={busy} aria-label={`Save name for ${m.fullName}`}>
                        <Check size={16} />
                      </button>
                    ) : (
                      <button type="button" className={styles.iconBtn} onClick={() => setRenaming({ userId: m.userId, name: m.fullName })} disabled={busy} aria-label={`Rename ${m.fullName}`}>
                        <Pencil size={14} />
                      </button>
                    ))}
                  <button type="button" className={`btn btn-outline ${styles.btnSm} ${styles.dangerBtn}`} onClick={() => remove(m)} disabled={busy} aria-label={`Remove ${m.fullName} from the team`}>
                    <UserMinus size={14} /> Remove
                  </button>
                </div>
              )}
              {linking === m.userId && (
                <div className={styles.full} style={{ flexBasis: "100%" }}>
                  <UserPicker
                    onSelect={(choice) => link(m, choice)}
                    excludeIds={view.members.map((x) => x.userId)}
                    placeholder={`Find the account for ${m.fullName}`}
                    disabled={busy}
                    autoFocus
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className={styles.addRow}>
          <UserPicker onSelect={add} excludeIds={view.members.map((m) => m.userId)} placeholder="Add a team member by name or email" disabled={busy} />
        </div>
      )}
      {canManage && <GuestMemberInput onAdd={addGuest} disabled={busy} />}
    </div>
  );
}

function SharingTab({ view, onChange, onLeft }) {
  const canManage = view.role !== "view";
  const [role, setRole] = useState("view");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handle = async (res) => {
    setBusy(false);
    if (!res.ok) return setError(res.error);
    if (res.data.removed) return onLeft();
    onChange(res.data);
  };

  const share = async (choice) => {
    setBusy(true);
    setError("");
    const ref = choice.userId ? { userId: choice.userId } : { identifier: choice.identifier };
    await handle(await api(planUrl(view.plan.planId, "/access"), { method: "PUT", body: { ...ref, role } }));
  };

  const changeRole = async (person, nextRole) => {
    setBusy(true);
    setError("");
    await handle(await api(planUrl(view.plan.planId, "/access"), { method: "PUT", body: { userId: person.userId, role: nextRole } }));
  };

  const remove = async (person) => {
    if (!window.confirm(`Stop sharing this plan with ${person.fullName}?`)) return;
    setBusy(true);
    setError("");
    await handle(await api(planUrl(view.plan.planId, `/access/${person.userId}`), { method: "DELETE" }));
  };

  const leave = async () => {
    if (!window.confirm("Leave this plan? You'll lose access until someone shares it with you again.")) return;
    setBusy(true);
    const res = await api(planUrl(view.plan.planId, "/leave"), { method: "POST" });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onLeft();
  };

  return (
    <div>
      <p className={styles.hint} style={{ marginBottom: "1rem" }}>
        People with edit access can change availability, rename Sprints, manage team members and share the plan. Read-only people can view and export.
      </p>
      <ErrorNotice message={error} />
      <ul className={styles.list}>
        {view.access.map((p) => (
          <li key={p.userId} className={styles.listItem}>
            <Person person={p} />
            <div className={styles.rowActions}>
              {p.role === "owner" || !canManage ? (
                <RoleBadge role={p.role} />
              ) : (
                <>
                  <select className="form-input" value={p.role} onChange={(e) => changeRole(p, e.target.value)} disabled={busy} aria-label={`Access for ${p.fullName}`}>
                    <option value="edit">Can edit</option>
                    <option value="view">Read only</option>
                  </select>
                  <button type="button" className={styles.iconBtn} onClick={() => remove(p)} disabled={busy} aria-label={`Stop sharing with ${p.fullName}`}>
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {canManage && (
        <div className={styles.addRow}>
          <UserPicker onSelect={share} excludeIds={view.access.map((p) => p.userId)} placeholder="Share with a name, email or username" disabled={busy} />
          <select className="form-input" style={{ padding: "0.55rem 0.75rem", fontSize: "0.9rem" }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Access for the new person">
            <option value="view">Read only</option>
            <option value="edit">Can edit</option>
          </select>
        </div>
      )}
      {view.role !== "owner" && (
        <button type="button" className={`btn btn-outline ${styles.btnSm} ${styles.dangerBtn}`} style={{ marginTop: "1.5rem" }} onClick={leave} disabled={busy}>
          Leave plan
        </button>
      )}
    </div>
  );
}

function OwnershipTab({ view, onChange, onDeleted }) {
  const editors = view.access.filter((p) => p.role === "edit");
  const [newOwner, setNewOwner] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const transfer = async () => {
    const person = editors.find((p) => p.userId === newOwner);
    if (!person || !window.confirm(`Make ${person.fullName} the owner of "${view.plan.name}"? You'll keep edit access.`)) return;
    setBusy(true);
    setError("");
    const res = await api(planUrl(view.plan.planId, "/transfer"), { method: "POST", body: { newOwnerId: newOwner } });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onChange(res.data);
  };

  const remove = async () => {
    const others = view.access.length - 1;
    const warning = others > 0 ? ` It will also be removed for the ${others} other ${others === 1 ? "person" : "people"} it's shared with.` : "";
    if (!window.confirm(`Delete "${view.plan.name}" permanently?${warning}`)) return;
    setBusy(true);
    setError("");
    const res = await api(planUrl(view.plan.planId), { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onDeleted();
  };

  return (
    <div>
      <ErrorNotice message={error} />
      <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Transfer ownership</h3>
      {editors.length === 0 ? (
        <p className={styles.hint}>Share the plan with someone as &ldquo;Can edit&rdquo; to be able to transfer it to them.</p>
      ) : (
        <div className={styles.addRow} style={{ marginTop: 0 }}>
          <select className="form-input" value={newOwner} onChange={(e) => setNewOwner(e.target.value)} aria-label="New owner">
            <option value="">Choose a new owner…</option>
            {editors.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.fullName}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-outline" onClick={transfer} disabled={!newOwner || busy}>
            Transfer
          </button>
        </div>
      )}
      <p className={styles.hint} style={{ marginTop: "0.5rem" }}>
        Each person can own up to {MAX_OWNED_PLANS} plans.
      </p>

      <h3 style={{ fontSize: "1rem", margin: "2rem 0 0.5rem" }}>Delete plan</h3>
      <p className={styles.hint} style={{ marginBottom: "0.75rem" }}>
        Deletes the plan and all availability for everyone it&rsquo;s shared with. This can&rsquo;t be undone.
      </p>
      <button type="button" className={`btn btn-outline ${styles.dangerBtn}`} onClick={remove} disabled={busy}>
        <Trash2 size={16} /> Delete plan
      </button>
    </div>
  );
}

/** Plan configuration: settings, team members, sharing and ownership. */
export function PlanConfigPanel({ view, initialTab = "settings", onChange, onClose, onDeleted, onLeft }) {
  const tabs = [
    ["settings", "Settings"],
    ["members", "Team members"],
    ["sharing", "Sharing"],
    ...(view.role === "owner" ? [["ownership", "Ownership"]] : []),
  ];
  const [selected, setTab] = useState(initialTab);
  // Ownership disappears after a transfer, so fall back to Settings.
  const tab = tabs.some(([id]) => id === selected) ? selected : "settings";

  return (
    <Modal title="Configure plan" subtitle={view.plan.name} onClose={onClose} size="lg">
      <div className={styles.tabs} role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} className={styles.tab} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "settings" && <SettingsTab view={view} onChange={onChange} />}
        {tab === "members" && <MembersTab view={view} onChange={onChange} />}
        {tab === "sharing" && <SharingTab view={view} onChange={onChange} onLeft={onLeft} />}
        {tab === "ownership" && <OwnershipTab view={view} onChange={onChange} onDeleted={onDeleted} />}
      </div>
    </Modal>
  );
}
