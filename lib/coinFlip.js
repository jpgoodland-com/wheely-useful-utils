import { secureRandomFloat } from "@/lib/secureRandom";

export const HEADS = "heads";
export const TAILS = "tails";
export const MAX_TOSS_COUNT = 100;
export const HISTORY_LIMIT = 100;

/** Alternation must be at least this long before any nudge applies. */
export const NUDGE_MIN_RUN = 4;
/** Each extra alternation beyond (NUDGE_MIN_RUN - 1) adds this much repeat probability. */
export const NUDGE_STEP = 0.03;
/** Hard cap on the nudge (repeat probability is at most 0.5 + cap = 65%). */
export const NUDGE_CAP = 0.15;

/**
 * Length of the trailing perfectly alternating run (H,T,H,T... or T,H,T,H...).
 * A single result counts as a run of 1.
 */
export function alternatingRunLength(history) {
  if (!Array.isArray(history) || history.length === 0) return 0;
  let run = 1;
  for (let i = history.length - 1; i > 0; i--) {
    if (history[i] !== history[i - 1]) run++;
    else break;
  }
  return run;
}

/**
 * Probability that the next toss repeats the last result.
 * 0.5 (fair) unless the history ends in a long alternating run; then it grows
 * by NUDGE_STEP per extra alternation, capped at 0.5 + NUDGE_CAP.
 */
export function repeatProbability(history) {
  const k = alternatingRunLength(history);
  if (k < NUDGE_MIN_RUN) return 0.5;
  const nudge = Math.min(NUDGE_CAP, NUDGE_STEP * (k - (NUDGE_MIN_RUN - 1)));
  return 0.5 + nudge;
}

/**
 * Toss a single coin. `history` is the server-held list of prior results
 * (oldest first). `rand` is injectable for testing; defaults to the CSPRNG.
 */
export function tossCoin(history = [], rand = secureRandomFloat) {
  const last = history.length ? history[history.length - 1] : null;
  const r = rand();
  if (!last) return r < 0.5 ? HEADS : TAILS;
  const pRepeat = repeatProbability(history);
  if (r < pRepeat) return last;
  return last === HEADS ? TAILS : HEADS;
}

/** Toss `count` coins sequentially (nudge applies across the batch). */
export function tossMany(count, history = [], rand = secureRandomFloat) {
  const n = Math.min(Math.max(Math.floor(Number(count)) || 1, 1), MAX_TOSS_COUNT);
  const running = [...history];
  const results = [];
  for (let i = 0; i < n; i++) {
    const r = tossCoin(running, rand);
    results.push(r);
    running.push(r);
  }
  return results;
}
