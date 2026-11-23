import crypto from "crypto";

/**
 * Single-use secrets sent by email (verification, password reset, invites).
 *
 * Only the SHA-256 hash is stored, so a leaked table or backup doesn't hand
 * out working links. The tokens are 256-bit random values, so a fast hash
 * is enough; bcrypt would add nothing.
 */

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/** Returns { token, hash }: email the token, store the hash. */
export function newToken() {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, hash: hashToken(token) };
}

/** Constant-time check of a presented token against a stored hash. */
export function tokenMatchesHash(token, storedHash) {
  if (typeof token !== "string" || !token || typeof storedHash !== "string" || !storedHash) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
