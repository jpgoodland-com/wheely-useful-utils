"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { api } from "./api";
import { PlanSettingsFields, defaultSettings, validateSettings } from "./PlanSettingsFields";
import { UserPicker } from "./UserPicker";
import { GuestMemberInput } from "./GuestMemberInput";
import styles from "./Capacity.module.css";

/** Create a team plan: settings plus initial team members. */
export function PlanFormModal({ currentUser, onClose, onCreated }) {
  const [settings, setSettings] = useState(defaultSettings);
  // App users ({ userId, fullName, email }) and people without an account ({ key, fullName, guest: true }).
  const [members, setMembers] = useState([]);
  const [includeSelf, setIncludeSelf] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const addMember = async (choice) => {
    setError("");
    if (choice.userId) {
      if (!members.some((m) => m.userId === choice.userId)) setMembers([...members, choice]);
      return;
    }
    setError("Pick someone from the suggestions, or add them by name as someone without an account");
  };

  const addGuest = (name) => {
    setError("");
    setMembers([...members, { key: `guest-${Date.now()}-${members.length}`, fullName: name, guest: true }]);
  };

  const submit = async (e) => {
    e?.preventDefault();
    const problem = validateSettings(settings);
    if (problem) return setError(problem);
    setSaving(true);
    setError("");
    const memberIds = [...(includeSelf ? [currentUser.userId] : []), ...members.filter((m) => !m.guest).map((m) => m.userId)];
    const guestNames = members.filter((m) => m.guest).map((m) => m.fullName);
    const res = await api("/api/capacity-plans", { method: "POST", body: { ...settings, name: settings.name.trim(), memberIds, guestNames } });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onCreated(res.data);
  };

  return (
    <Modal
      title="New team plan"
      subtitle="You can change any of this later from the plan's configuration."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="new-plan-form" className="btn btn-primary" disabled={saving}>
            {saving ? "Creating…" : "Create plan"}
          </button>
        </>
      }
    >
      <form id="new-plan-form" onSubmit={submit}>
        {error && (
          <div className={`${styles.notice} ${styles.error}`} role="alert">
            {error}
          </div>
        )}
        <PlanSettingsFields value={settings} onChange={setSettings} />

        <div className="form-group">
          <span className="form-label">Team members</span>
          <label className={styles.checkRow}>
            <input type="checkbox" checked={includeSelf} onChange={(e) => setIncludeSelf(e.target.checked)} />
            Include me as a team member
          </label>
          <UserPicker onSelect={addMember} excludeIds={members.map((m) => m.userId)} placeholder="Add a team member by name or email" />
          <GuestMemberInput onAdd={addGuest} />
          <span className={styles.hint}>
            Team members with an account get edit access so they can enter their availability. For people without an account, anyone who can edit the plan fills in their availability.
          </span>
          {members.length > 0 && (
            <ul className={styles.list} style={{ marginTop: "0.5rem" }}>
              {members.map((m) => (
                <li key={m.userId || m.key} className={styles.listItem}>
                  <div className={styles.person}>
                    <span>{m.fullName}</span>
                    <span className={styles.muted}>{m.guest ? "No account" : m.email}</span>
                  </div>
                  <button type="button" className={styles.iconBtn} aria-label={`Remove ${m.fullName}`} onClick={() => setMembers(members.filter((x) => x !== m))}>
                    <X size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </form>
    </Modal>
  );
}
