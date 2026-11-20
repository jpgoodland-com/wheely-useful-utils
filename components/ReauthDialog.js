"use client";

import { useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { Modal } from "@/components/Modal";
import { useAuth } from "@/lib/AuthContext";

const PROVIDER_NAMES = { google: "Google", microsoft: "Microsoft", github: "GitHub" };

/**
 * Step-up re-authentication for sensitive actions.
 *
 *   const { fetchWithReauth, reauthDialog } = useReauth();
 *   const res = await fetchWithReauth("/api/...", { method: "DELETE" });
 *   ...
 *   return <>{page}{reauthDialog}</>;
 *
 * When the server answers 401 with `reauthRequired`, the dialog asks for
 * everything the account has (the password, plus a code or passkey if MFA
 * is on) and the request is retried once. Accounts with neither sign in
 * with their provider again (a full redirect back to this page), after
 * which the user repeats the action.
 */
export function useReauth() {
  const [pending, setPending] = useState(null);
  const resolveRef = useRef(null);

  const askToConfirm = useCallback(
    () =>
      new Promise((resolve) => {
        resolveRef.current = resolve;
        setPending(true);
      }),
    []
  );

  const finish = useCallback((confirmed) => {
    setPending(null);
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
  }, []);

  const fetchWithReauth = useCallback(
    async (url, options) => {
      const res = await fetch(url, options);
      if (res.status !== 401) return res;
      const data = await res.clone().json().catch(() => ({}));
      if (!data.reauthRequired) return res;
      if (!(await askToConfirm())) return res;
      return fetch(url, options);
    },
    [askToConfirm]
  );

  const reauthDialog = pending ? <ReauthDialog onDone={finish} /> : null;
  return { fetchWithReauth, reauthDialog };
}

function ReauthDialog({ onDone }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const providers = user?.oauthProviders || [];
  const methods = user?.mfaMethods || [];
  const mfa = user?.mfaEnabled === true;
  const codeMethod = methods.includes("totp") ? "totp" : "recovery";
  const canUseCode = methods.includes("totp") || methods.includes("recovery");
  const canUsePasskey = methods.includes("webauthn") && browserSupportsWebAuthn();
  const canConfirmHere = user?.hasPassword || mfa;

  const send = async (factor) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(user?.hasPassword ? { password } : {}), ...factor }),
      });
      if (res.ok) {
        onDone(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Couldn't confirm. Please try again.");
    } catch {
      setError("Couldn't confirm. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    // A recovery code looks like "xxxxx-xxxxx"; anything else is a TOTP code.
    send(mfa ? { method: /[a-z-]/i.test(code) || !methods.includes("totp") ? "recovery" : codeMethod, code } : {});
  };

  const confirmWithPasskey = async () => {
    setError("");
    try {
      const res = await fetch("/api/auth/reauth/passkey-options", { method: "POST" });
      if (!res.ok) throw new Error("options");
      const response = await startAuthentication({ optionsJSON: await res.json() });
      await send({ method: "webauthn", response });
    } catch {
      setError("The passkey wasn't used. Please try again.");
    }
  };

  return (
    <Modal
      title="Confirm it's you"
      subtitle="This action needs a recent sign-in."
      onClose={() => onDone(false)}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={() => onDone(false)}>
            Cancel
          </button>
          {canConfirmHere && (!mfa || canUseCode) && (
            <button type="submit" form="reauth-form" className="btn btn-primary" disabled={busy || (user?.hasPassword && !password) || (mfa && !code)}>
              {busy ? "Checking…" : "Confirm"}
            </button>
          )}
        </>
      }
    >
      {canConfirmHere ? (
        <form id="reauth-form" onSubmit={submit}>
          {user?.hasPassword && (
            <div className="form-group">
              <label htmlFor="reauth-password" className="form-label">Password</label>
              <input
                id="reauth-password"
                type="password"
                className="form-input"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-autofocus
                required
              />
            </div>
          )}
          {mfa && canUseCode && (
            <div className="form-group">
              <label htmlFor="reauth-code" className="form-label">
                {methods.includes("totp") ? "Authenticator code (or a recovery code)" : "Recovery code"}
              </label>
              <input
                id="reauth-code"
                className="form-input"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                {...(user?.hasPassword ? {} : { "data-autofocus": true })}
              />
            </div>
          )}
          {mfa && canUsePasskey && (
            <button type="button" className="btn btn-outline" onClick={confirmWithPasskey} disabled={busy || (user?.hasPassword && !password)}>
              Use a passkey
            </button>
          )}
        </form>
      ) : (
        <p>Sign in again with your provider, then repeat the action.</p>
      )}
      {!mfa && providers.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
          {providers.map((p) => (
            <a key={p} className="btn btn-outline" href={`/api/auth/oauth/${p}?next=${encodeURIComponent(pathname || "/settings")}`}>
              Continue with {PROVIDER_NAMES[p] || p}
            </a>
          ))}
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
