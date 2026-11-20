import crypto from "crypto";

/**
 * Cryptographically secure pseudo-random float in [0, 1).
 * Uses 48 bits of entropy from crypto.randomBytes to avoid PRNG predictability.
 */
export function secureRandomFloat() {
  const buf = crypto.randomBytes(6);
  const intVal = buf.readUIntBE(0, 6);
  return intVal / 0x1000000000000;
}
