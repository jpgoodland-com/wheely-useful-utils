// Spin profile: smoothstep push, steady cruise, then a quadratic slow-down.
// Speed is v(t); every phase integrates in closed form so the wheel lands exactly on `distance`.

export function planSpin({ distance, rampMs, cruiseMs, decelMs }) {
  const tA = Math.max(1, rampMs) / 1000;
  const tC = Math.max(0, cruiseMs) / 1000;
  const tD = Math.max(1, decelMs) / 1000;
  const total = tA + tC + tD;
  const vMax = distance / (tA / 2 + tC + tD / 3);

  function angleAt(tSec) {
    if (tSec <= 0) return 0;
    if (tSec >= total) return distance;
    if (tSec < tA) {
      const x = tSec / tA;
      return vMax * tA * (x ** 3 - x ** 4 / 2);
    }
    const afterRamp = (vMax * tA) / 2;
    if (tSec < tA + tC) return afterRamp + vMax * (tSec - tA);
    const afterCruise = afterRamp + vMax * tC;
    const x = (tSec - tA - tC) / tD;
    return afterCruise + (vMax * tD * (1 - (1 - x) ** 3)) / 3;
  }

  function speedAt(tSec) {
    if (tSec <= 0 || tSec >= total) return 0;
    if (tSec < tA) {
      const x = tSec / tA;
      return vMax * (3 * x * x - 2 * x ** 3);
    }
    if (tSec < tA + tC) return vMax;
    const x = (tSec - tA - tC) / tD;
    return vMax * (1 - x) ** 2;
  }

  return { total, vMax, distance, angleAt, speedAt };
}

// No rotation animation: the wheel jumps to the winning slice and holds, for prefers-reduced-motion.
export function planSnap({ distance, holdMs }) {
  const total = Math.max(1, holdMs) / 1000;
  return { total, vMax: 0, distance, angleAt: (tSec) => (tSec > 0 ? distance : 0), speedAt: () => 0 };
}

export function randomSpinTiming(rng = Math.random, reduced = false) {
  if (reduced) return { turns: 0, snap: true, holdMs: 600 };
  return {
    turns: 6 + Math.floor(rng() * 4),
    rampMs: 900,
    cruiseMs: 500 + Math.floor(rng() * 400),
    decelMs: 4200 + Math.floor(rng() * 1300),
  };
}
