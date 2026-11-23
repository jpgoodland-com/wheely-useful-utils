/**
 * Content Security Policy (security plan M1), set per request by proxy.js.
 *
 * Pages get a fresh nonce: only scripts carrying it (Next.js adds it to its
 * own scripts during rendering) or loaded by them ('strict-dynamic') run,
 * so injected markup can't execute script. 'unsafe-eval' is only added in
 * development, where React needs it for error overlays. Styles keep
 * 'unsafe-inline' because React `style` attributes can't carry a nonce.
 *
 * API responses are JSON or files and never need to run anything.
 */
export function pageCsp(nonce, { dev = false, https = false } = {}) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

export function newNonce() {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}
