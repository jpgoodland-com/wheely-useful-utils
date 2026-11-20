/**
 * Cross-site request forgery check (security plan M2), run by proxy.js on
 * every state-changing request.
 *
 * Browsers send `Origin` on every cross-origin POST/PUT/PATCH/DELETE, and
 * modern ones also send `Sec-Fetch-Site`. A request is refused when either
 * header shows it came from another site. Requests with neither header
 * come from non-browser clients (curl, server-to-server), which a CSRF
 * attacker can't drive with the victim's cookies, so they're allowed.
 *
 * Returns null when the request is fine, otherwise a short reason code
 * for the security log.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfViolation({ method, headers }, trustedOrigin) {
  if (SAFE_METHODS.has(method)) return null;
  const origin = headers.get("origin");
  if (origin !== null) {
    // "null" (sandboxed frames, some redirects) is never trusted.
    return origin === trustedOrigin ? null : "origin";
  }
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "fetch-site";
  return null;
}
