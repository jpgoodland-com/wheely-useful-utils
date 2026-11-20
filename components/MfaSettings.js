"use client";

import { useCallback, useEffect, useState } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useAuth } from "@/lib/AuthContext";
import { useReauth } from "@/components/ReauthDialog";

/** Recovery codes are shown exactly once, right after they're created. */
function RecoveryCodes({ codes, onDone }) {
  return (
    <div role="region" aria-label="Your recovery codes" style={{ border: "1px solid var(--border-color, rgba(127,127,127,0.35))", borderRadius: "8px", padding: "1rem", marginTop: "1rem" }}>
      <strong>Save your recovery codes</strong>
      <p style={{ fontSize: "0.9rem" }}>
        Each code works once if you lose your authenticator. Store them somewhere safe: they won&apos;t be shown again.
      </p>
      <ul style={{ fontFamily: "monospace", columns: 2, listStyle: "none", padding: 0 }}>
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <button type="button" className="btn btn-primary" onClick={onDone}>I&apos;ve saved them</button>
    </div>
  );
}

export function MfaSettings() {
  const { user, refreshUser } = useAuth();
  const { fetchWithReauth, reauthDialog } = useReauth();
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null); // { qrDataUrl, secret } during TOTP setup
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [message, setMessage] = useState("");
  const [passkeyName, setPasskeyName] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/mfa");
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const apply = async (res, success) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (!data.reauthRequired) setMessage(data.error || "Something went wrong. Please try again.");
      return null;
    }
    setStatus(data);
    if (data.recoveryCodes) setRecoveryCodes(data.recoveryCodes);
    if (success) setMessage(success);
    await refreshUser();
    return data;
  };

  const startTotp = async () => {
    setMessage("");
    const res = await fetchWithReauth("/api/auth/mfa/totp", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setSetup(data);
    else if (!data.reauthRequired) setMessage(data.error || "Couldn't start setup.");
  };

  const confirmTotp = async (e) => {
    e.preventDefault();
    const res = await fetch("/api/auth/mfa/totp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (await apply(res, "Authenticator app is on. Other devices have been signed out.")) {
      setSetup(null);
      setCode("");
    }
  };

  const removeTotp = async () => {
    setMessage("");
    await apply(await fetchWithReauth("/api/auth/mfa/totp", { method: "DELETE" }), "Authenticator app removed.");
  };

  const addPasskey = async () => {
    setMessage("");
    const res = await fetchWithReauth("/api/auth/mfa/passkeys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const options = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (!options.reauthRequired) setMessage(options.error || "Couldn't add a passkey.");
      return;
    }
    let response;
    try {
      response = await startRegistration({ optionsJSON: options });
    } catch {
      setMessage("The passkey wasn't created.");
      return;
    }
    const done = await fetch("/api/auth/mfa/passkeys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response, name: passkeyName || "Passkey" }),
    });
    if (await apply(done, "Passkey added. Other devices have been signed out.")) setPasskeyName("");
  };

  const removePasskey = async (id) => {
    setMessage("");
    await apply(await fetchWithReauth(`/api/auth/mfa/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" }), "Passkey removed.");
  };

  const newRecoveryCodes = async () => {
    setMessage("");
    await apply(await fetchWithReauth("/api/auth/mfa/recovery-codes", { method: "POST" }), "New recovery codes created. The old ones no longer work.");
  };

  if (!status) return <p>Loading two-step verification…</p>;

  return (
    <section className="glass-panel mb-8" style={{ padding: "1.5rem" }} aria-labelledby="mfa-heading">
      {reauthDialog}
      <h3 id="mfa-heading" style={{ marginTop: 0 }}>Two-step verification</h3>
      {user?.adminMfaRequired && (
        <p role="alert" className="form-error">
          Your account has administrator rights. Set up an authenticator app or passkey to use them.
        </p>
      )}
      <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
        {status.enabled
          ? "On: signing in asks for a second step after your password or provider."
          : "Off: add an authenticator app or a passkey to protect your account."}
      </p>
      {message && <p role="status">{message}</p>}
      {recoveryCodes && <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />}

      <h4>Authenticator app</h4>
      {status.totp ? (
        <button type="button" className="btn btn-outline" onClick={removeTotp}>Remove authenticator app</button>
      ) : setup ? (
        <form onSubmit={confirmTotp} style={{ display: "grid", gap: "0.75rem", maxWidth: "320px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL QR code */}
          <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={220} height={220} />
          <p style={{ fontSize: "0.85rem", margin: 0 }}>
            Can&apos;t scan? Enter this key: <code data-testid="totp-secret">{setup.secret}</code>
          </p>
          <label htmlFor="totp-confirm" className="form-label">Enter the 6-digit code it shows</label>
          <input id="totp-confirm" className="form-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" className="btn btn-primary">Turn on</button>
            <button type="button" className="btn btn-outline" onClick={() => setSetup(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-primary" onClick={startTotp}>Set up authenticator app</button>
      )}

      <h4>Passkeys</h4>
      {status.passkeys.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {status.passkeys.map((p) => (
            <li key={p.id} style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "0.5rem" }}>
              <span>{p.name}</span>
              <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>added {new Date(p.createdAt).toLocaleDateString()}</span>
              <button type="button" className="btn btn-outline" onClick={() => removePasskey(p.id)} aria-label={`Remove passkey ${p.name}`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {browserSupportsWebAuthn() ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="passkey-name" className="form-label">Passkey name</label>
            <input id="passkey-name" className="form-input" maxLength={40} placeholder="e.g. Work laptop" value={passkeyName} onChange={(e) => setPasskeyName(e.target.value)} />
          </div>
          <button type="button" className="btn btn-outline" onClick={addPasskey}>Add a passkey</button>
        </div>
      ) : (
        <p style={{ fontSize: "0.9rem" }}>This browser doesn&apos;t support passkeys.</p>
      )}

      {status.enabled && (
        <>
          <h4>Recovery codes</h4>
          <p style={{ fontSize: "0.9rem" }}>{status.recoveryCodesRemaining} unused.</p>
          <button type="button" className="btn btn-outline" onClick={newRecoveryCodes}>Create new recovery codes</button>
        </>
      )}
    </section>
  );
}
