"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { MfaSettings } from "@/components/MfaSettings";
import { SecurityActivity } from "@/components/SecurityActivity";

const METHOD_LABELS = {
  pwd: "Password",
  "oauth:google": "Google",
  "oauth:microsoft": "Microsoft",
  "oauth:github": "GitHub",
};

function describeAgent(ua) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export default function SecuritySettingsPage() {
  const router = useRouter();
  const { user, loading, logoutLocally } = useAuth();
  const [sessions, setSessions] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/sessions");
    if (res.ok) setSessions((await res.json()).sessions);
    else setMessage("Couldn't load your sessions.");
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const signOutOthers = async () => {
    setMessage("");
    const res = await fetch("/api/auth/sessions", { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMessage(data.revoked === 1 ? "Signed out of 1 other session." : `Signed out of ${data.revoked} other sessions.`);
      load();
    } else {
      setMessage(data.error || "Couldn't sign out other sessions.");
    }
  };

  const revoke = async (id) => {
    setMessage("");
    const res = await fetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.error || "Couldn't sign out that session.");
      return;
    }
    if (data.current) {
      logoutLocally();
      return;
    }
    load();
  };

  if (loading || !user) {
    return <div className="text-center mt-8">Loading...</div>;
  }

  const others = (sessions || []).filter((s) => !s.current).length;

  return (
    <div>
      <nav className="breadcrumb">
        <Link href="/dashboard">Dashboard</Link>
        <ChevronRight size={14} className="separator" />
        <Link href="/settings">Settings</Link>
        <ChevronRight size={14} className="separator" />
        <span>Security</span>
      </nav>

      <div className="page-header">
        <h2>Security</h2>
      </div>

      <MfaSettings />

      <section className="glass-panel mb-8" style={{ padding: "1.5rem" }} aria-labelledby="sessions-heading">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "space-between", alignItems: "center" }}>
          <h3 id="sessions-heading" style={{ margin: 0 }}>Where you&apos;re signed in</h3>
          <button type="button" className="btn btn-outline" onClick={signOutOthers} disabled={others === 0}>
            Sign out everywhere else
          </button>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Sessions end after 30 minutes without activity, and after 12 hours at most.
        </p>
        {message && <p role="status">{message}</p>}
        {sessions === null ? (
          <p>Loading sessions…</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
            {sessions.map((s) => (
              <li
                key={s.id}
                style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-color, rgba(127,127,127,0.25))", paddingTop: "0.75rem" }}
              >
                <div>
                  <strong>{describeAgent(s.userAgent)}</strong>
                  {s.current && <span style={{ marginLeft: "0.5rem", color: "var(--text-muted)" }}>(this browser)</span>}
                  <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    {METHOD_LABELS[s.method] || s.method} · {s.ip} · last active {new Date(s.lastSeenAt).toLocaleString()}
                  </div>
                </div>
                <button type="button" className="btn btn-outline" onClick={() => revoke(s.id)} aria-label={`Sign out ${describeAgent(s.userAgent)}${s.current ? " (this browser)" : ""}`}>
                  Sign out
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SecurityActivity />
    </div>
  );
}
