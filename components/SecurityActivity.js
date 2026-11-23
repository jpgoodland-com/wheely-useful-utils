"use client";

import { useEffect, useState } from "react";

export const ACTION_LABELS = {
  "account.created": "Account created",
  "account.deleted": "Account deleted",
  "auth.session_started": "Signed in",
  "auth.logout": "Signed out",
  "auth.reauthenticated": "Confirmed identity",
  "auth.sessions_revoked": "Signed out other sessions",
  "auth.session_revoked": "Signed out a session",
  "auth.password_reset": "Password reset",
  "mfa.totp_enabled": "Authenticator app turned on",
  "mfa.totp_removed": "Authenticator app removed",
  "mfa.passkey_added": "Passkey added",
  "mfa.passkey_removed": "Passkey removed",
  "mfa.recovery_regenerated": "New recovery codes created",
  "admin.user_created": "User created by an admin",
  "admin.user_deleted": "User deleted by an admin",
  "admin.role_granted": "Admin rights granted",
  "admin.role_revoked": "Admin rights removed",
  "admin.password_set": "Password set by an admin",
  "admin.invite_sent": "Invitation sent",
};

/** The signed-in user's recent security events (from the audit trail). */
export function SecurityActivity() {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/activity")
      .then(async (res) => {
        if (!res.ok) throw new Error("load");
        setRecords((await res.json()).records);
      })
      .catch(() => setError("Couldn't load recent activity."));
  }, []);

  return (
    <section className="glass-panel mb-8" style={{ padding: "1.5rem" }} aria-labelledby="activity-heading">
      <h3 id="activity-heading" style={{ marginTop: 0 }}>Recent security activity</h3>
      {error && <p role="status">{error}</p>}
      {!records && !error && <p>Loading…</p>}
      {records?.length === 0 && <p>No activity yet.</p>}
      {records?.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {records.map((r) => (
            <li key={`${r.at}-${r.action}`} style={{ fontSize: "0.9rem" }}>
              <strong>{ACTION_LABELS[r.action] || r.action}</strong>
              <span style={{ color: "var(--text-muted)" }}> · {new Date(r.at).toLocaleString()} · {r.ip}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
