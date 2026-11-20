"use client";

import { useCallback, useEffect, useState } from "react";
import { ACTION_LABELS } from "@/components/SecurityActivity";

/** Platform audit log for admins, newest first, with "load more" paging. */
export function AuditLog() {
  const [records, setRecords] = useState([]);
  const [next, setNext] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (cursor) => {
    try {
      const res = await fetch(`/api/admin/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!res.ok) throw new Error("load");
      const data = await res.json();
      setRecords((prev) => (cursor ? [...prev, ...data.records] : data.records));
      setNext(data.next);
    } catch {
      setError("Couldn't load the audit log.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load(null);
  }, [load]);

  return (
    <section className="glass-panel mb-8" style={{ padding: "1.5rem" }} aria-labelledby="audit-heading">
      <h3 id="audit-heading" style={{ marginTop: 0 }}>Audit log</h3>
      {error && <p role="status">{error}</p>}
      {loaded && !records.length && !error && <p>No admin actions recorded yet.</p>}
      {records.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">When</th>
                <th align="left">Action</th>
                <th align="left">Admin</th>
                <th align="left">Target user</th>
                <th align="left">IP</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.ts}>
                  <td>{new Date(r.ts.split("#")[0]).toLocaleString()}</td>
                  <td>{ACTION_LABELS[r.action] || r.action}</td>
                  <td><code>{r.actorUserId}</code></td>
                  <td>{r.targetUserId ? <code>{r.targetUserId}</code> : "—"}</td>
                  <td>{r.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <button type="button" className="btn btn-outline" onClick={() => load(next)} style={{ marginTop: "0.75rem" }}>
          Load more
        </button>
      )}
    </section>
  );
}
