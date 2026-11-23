"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { useAuth } from "@/lib/AuthContext";
import { safeNextPath } from "@/lib/url";

function MfaForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useAuth();
  const [methods, setMethods] = useState(null);
  const [mode, setMode] = useState("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fallbackNext = safeNextPath(searchParams.get("next"));

  useEffect(() => {
    fetch("/api/auth/mfa/challenge")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          router.replace("/login?error=session_expired");
          return;
        }
        setMethods(data.methods);
        setMode(data.methods.includes("totp") ? "totp" : data.methods.includes("webauthn") ? "webauthn" : "recovery");
      })
      .catch(() => setError("Couldn't load your sign-in. Please try again."));
  }, [router]);

  const finish = async (payload) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await refreshUser();
        router.push(data.next && data.next !== "/dashboard" ? data.next : fallbackNext);
        return;
      }
      if (data.restart) {
        router.replace("/login?error=session_expired");
        return;
      }
      setError(data.error || "That didn't work. Please try again.");
    } catch {
      setError("That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = (e) => {
    e.preventDefault();
    finish({ method: mode, code });
  };

  const confirmWithPasskey = async () => {
    setError("");
    try {
      const res = await fetch("/api/auth/mfa/passkey-options", { method: "POST" });
      if (!res.ok) {
        router.replace("/login?error=session_expired");
        return;
      }
      const response = await startAuthentication({ optionsJSON: await res.json() });
      await finish({ method: "webauthn", response });
    } catch {
      setError("The passkey wasn't used. Try again or use a code instead.");
    }
  };

  if (!methods) return <div className="text-center mt-8">Loading...</div>;

  const passkeys = methods.includes("webauthn") && browserSupportsWebAuthn();

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1, padding: "2rem" }}>
      <div className="glass-panel" style={{ width: "100%", maxWidth: "420px" }}>
        <h2 className="text-center">Two-step verification</h2>
        {error && <div className="form-error mb-4" role="alert">{error}</div>}

        {mode !== "webauthn" && (
          <form onSubmit={submitCode}>
            <div className="form-group">
              <label htmlFor="mfa-code" className="form-label">
                {mode === "totp" ? "Code from your authenticator app" : "Recovery code"}
              </label>
              <input
                id="mfa-code"
                className="form-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode={mode === "totp" ? "numeric" : "text"}
                autoComplete="one-time-code"
                placeholder={mode === "totp" ? "123456" : "xxxxx-xxxxx"}
                maxLength={mode === "totp" ? 6 : 11}
                autoFocus
                required
              />
            </div>
            <button type="submit" className="btn btn-primary w-100" disabled={busy || !code}>
              {busy ? "Checking…" : "Verify"}
            </button>
          </form>
        )}

        {mode === "webauthn" && (
          <button type="button" className="btn btn-primary w-100" onClick={confirmWithPasskey} disabled={busy}>
            Use a passkey
          </button>
        )}

        <div style={{ display: "grid", gap: "0.5rem", marginTop: "1rem" }}>
          {passkeys && mode !== "webauthn" && (
            <button type="button" className="btn btn-outline" onClick={() => setMode("webauthn")}>Use a passkey instead</button>
          )}
          {methods.includes("totp") && mode !== "totp" && (
            <button type="button" className="btn btn-outline" onClick={() => { setMode("totp"); setCode(""); }}>Use your authenticator app</button>
          )}
          {methods.includes("recovery") && mode !== "recovery" && (
            <button type="button" className="btn btn-outline" onClick={() => { setMode("recovery"); setCode(""); }}>Use a recovery code</button>
          )}
        </div>
        <p className="text-center mt-4">
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default function MfaPage() {
  return (
    <Suspense fallback={<div className="text-center mt-8">Loading...</div>}>
      <MfaForm />
    </Suspense>
  );
}
