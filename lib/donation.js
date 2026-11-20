/**
 * Donation link helpers.
 *
 * DONATION_URL is operator-supplied configuration, but it is rendered into an
 * <a href>, so it is validated before use: only https links to PayPal hosts
 * are accepted. This blocks javascript:/data: URIs and open-redirect style
 * misconfiguration (e.g. a typo'd or tampered secret).
 */

// Typical for small open source projects (Buy Me a Coffee / GitHub Sponsors one-time tiers)
export const SUGGESTED_AMOUNTS = [3, 5, 10, 25];
export const DEFAULT_AMOUNT = 5;

const ALLOWED_HOSTS = new Set(["paypal.me", "www.paypal.me", "paypal.com", "www.paypal.com"]);

/**
 * Return a normalised, safe donation URL or "" if the input is not acceptable.
 */
export function sanitizeDonationUrl(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return "";

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return "";
  }

  if (url.protocol !== "https:") return "";
  if (url.username || url.password) return "";
  if (url.port) return "";
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return "";

  return url.toString();
}

/**
 * Build the final link. Only amounts from SUGGESTED_AMOUNTS are ever appended,
 * so user-controlled input cannot alter the URL. paypal.me links accept an
 * amount path segment: paypal.me/name/5USD
 */
export function buildDonationLink(baseUrl, amount) {
  const safe = sanitizeDonationUrl(baseUrl);
  if (!safe) return "";

  const url = new URL(safe);
  if (/(^|\.)paypal\.me$/i.test(url.hostname) && SUGGESTED_AMOUNTS.includes(amount)) {
    url.search = "";
    url.hash = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${amount}USD`;
    return url.toString();
  }
  return safe;
}
