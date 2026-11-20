/**
 * In-process sliding-window rate limiter.
 *
 * Keyed by an arbitrary string (e.g. "ip:route-group").
 * Each bucket stores an array of timestamps; entries older than
 * `windowMs` are pruned on every check.
 *
 * NOTE: This is per-process. Production runs two ECS tasks behind the
 * ALB, so each task keeps its own buckets and a client spread
 * across both can get up to twice each limit. A shared store (Redis,
 * DynamoDB, etc.) would make the limits exact.
 */

/** @type {Map<string, number[]>} */
const store = new Map()

// Prevent unbounded memory growth: evict buckets that haven't been
// touched in more than 10 minutes.
const EVICT_AFTER_MS = 10 * 60 * 1000
const evictAt = new Map() // key -> last-access timestamp

function evictStale() {
  const now = Date.now()
  for (const [key, ts] of evictAt) {
    if (now - ts > EVICT_AFTER_MS) {
      store.delete(key)
      evictAt.delete(key)
    }
  }
}

// Run eviction every 5 minutes
setInterval(evictStale, 5 * 60 * 1000).unref?.()

/**
 * @param {string} key        - Unique bucket identifier
 * @param {number} limit      - Max requests allowed in the window
 * @param {number} windowMs   - Window size in milliseconds
 * @returns {{ allowed: boolean, remaining: number, resetMs: number, firstBlocked: boolean }}
 *   `firstBlocked` is true only for the request that first goes over the limit,
 *   so callers can log one event per burst rather than one per request.
 */
export function checkRateLimit(key, limit, windowMs) {
  const now = Date.now()
  const windowStart = now - windowMs

  let timestamps = store.get(key) ?? []
  // Prune expired entries
  timestamps = timestamps.filter(t => t > windowStart)
  timestamps.push(now)
  store.set(key, timestamps)
  evictAt.set(key, now)

  const count = timestamps.length
  const allowed = count <= limit
  const remaining = Math.max(0, limit - count)
  // Oldest entry in window + windowMs = when the window resets for this key
  const oldest = timestamps[0] ?? now
  const resetMs = oldest + windowMs

  return { allowed, remaining, resetMs, firstBlocked: count === limit + 1 }
}
