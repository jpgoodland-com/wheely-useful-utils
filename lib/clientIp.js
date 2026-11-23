/**
 * Client IP for rate limiting and security logs.
 *
 * The ALB appends the address it saw to X-Forwarded-For, so the rightmost
 * entry is the only one a client can't forge. Anything to its left was sent
 * by the client and must never be used as a rate-limit key: rotating it
 * would give an attacker a fresh bucket on every request.
 *
 * Works with Edge-runtime and Node `Headers`, so proxy.js and route
 * handlers share it.
 */
export function getClientIp(headers) {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const clean = last.replace(/[^\w.:-]/g, "").slice(0, 64);
    if (clean) return clean;
  }
  return "local";
}
