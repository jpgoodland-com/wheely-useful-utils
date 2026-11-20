/**
 * Sessions expire after 30 minutes. Send the user to sign in again and bring
 * them back to this page, instead of showing a bare "Unauthorized" error.
 */
function redirectToLogin() {
  if (typeof window === "undefined") return;
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?${new URLSearchParams({ error: "session_expired", next })}`);
}

/** JSON fetch wrapper for the capacity API. Resolves to { ok, data, error, status }. */
export async function api(url, { method = "GET", body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      redirectToLogin();
      return { ok: false, status: 401, error: "Your session expired. Redirecting to sign in…", data };
    }
    if (!res.ok) return { ok: false, status: res.status, error: data.error || "Something went wrong", data };
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 0, error: "Network error — please try again" };
  }
}

export const planUrl = (planId, suffix = "") => `/api/capacity-plans/${encodeURIComponent(planId)}${suffix}`;
