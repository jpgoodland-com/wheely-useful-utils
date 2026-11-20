// Shared prefers-reduced-motion check for client components. Safe during SSR
// (no window) and in jsdom or older browsers without matchMedia.

const QUERY = "(prefers-reduced-motion: reduce)";

/** The reduced-motion MediaQueryList, or null when matchMedia isn't available. */
export function reducedMotionQuery() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(QUERY) ?? null;
  } catch {
    return null;
  }
}

export function prefersReducedMotion() {
  return !!reducedMotionQuery()?.matches;
}
