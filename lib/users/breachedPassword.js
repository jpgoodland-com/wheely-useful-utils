import crypto from "crypto";

/**
 * Rejects passwords already exposed in data breaches (security plan M4),
 * using the Have I Been Pwned range API with k-anonymity: only the first
 * five hex characters of the password's SHA-1 leave the server, and the
 * match happens locally. "Add-Padding" makes every response the same size.
 *
 * Fails open (returns false) on timeout or error so an outage at HIBP never
 * blocks signups; the local rules in lib/password.js still apply. Set
 * BREACHED_PASSWORD_CHECK=off to skip the call (offline dev, e2e).
 */
const RANGE_URL = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 2000;

export async function isBreachedPassword(password) {
  if (process.env.BREACHED_PASSWORD_CHECK === "off" || typeof password !== "string") return false;
  const sha1 = crypto.createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(`${RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "wheel-app" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
    if (!res.ok) return false;
    const body = await res.text();
    for (const line of body.split("\n")) {
      const [hashSuffix, count] = line.trim().split(":");
      if (hashSuffix === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch (e) {
    console.warn("Breached-password check unavailable:", e?.name || "error");
    return false;
  }
}

export const BREACHED_MESSAGE =
  "This password has appeared in a data breach, so it isn't safe to use. Please choose a different one.";
