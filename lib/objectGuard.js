// Keys that can reach Object.prototype when copied from parsed JSON.
export const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** True for a non-null, non-array object with no prototype-polluting own keys. */
export function isSafePlainObject(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  for (const k of Object.keys(o)) {
    if (FORBIDDEN_KEYS.has(k)) return false;
  }
  return true;
}
