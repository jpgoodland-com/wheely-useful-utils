import crypto from "crypto";
import { hashToken } from "@/lib/tokens";

/**
 * Single-use recovery codes for when the authenticator is lost.
 * Ten codes of 10 base32 characters (50 bits each), shown once as
 * "xxxxx-xxxxx" and stored only as SHA-256 hashes.
 */

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l confusion
export const RECOVERY_CODE_COUNT = 10;

export function normalizeRecoveryCode(code) {
  return String(code ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(10);
    const raw = [...bytes].map((b) => ALPHABET[b % 32]).join("");
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return { codes, hashes: codes.map((c) => hashToken(normalizeRecoveryCode(c))) };
}

/** Index of the matching stored hash, or -1. */
export function findRecoveryCode(hashes, code) {
  const clean = normalizeRecoveryCode(code);
  if (clean.length !== 10 || !Array.isArray(hashes)) return -1;
  const candidate = Buffer.from(hashToken(clean), "hex");
  let found = -1;
  // Compare against every hash so timing doesn't reveal the position.
  hashes.forEach((h, i) => {
    const stored = Buffer.from(String(h), "hex");
    if (stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate) && found < 0) found = i;
  });
  return found;
}
