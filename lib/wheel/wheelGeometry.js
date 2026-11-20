export const TAU = Math.PI * 2;
// Canvas angles run clockwise from 3 o'clock, so the pointer at 12 o'clock is -90 degrees.
export const POINTER_ANGLE = -Math.PI / 2;

export const mod = (a, n) => ((a % n) + n) % n;

export function buildSlices(categories) {
  const total = categories.reduce((sum, c) => sum + Math.max(0, c.weight || 0), 0);
  if (total <= 0) return [];
  let start = 0;
  return categories.map((c) => {
    const angle = (Math.max(0, c.weight || 0) / total) * TAU;
    const slice = { start, end: start + angle, angle, mid: start + angle / 2 };
    start += angle;
    return slice;
  });
}

export function sliceIndexAt(slices, rotation) {
  if (slices.length === 0) return -1;
  const a = mod(POINTER_ANGLE - rotation, TAU);
  for (let i = 0; i < slices.length; i++) {
    if (a >= slices[i].start && a < slices[i].end) return i;
  }
  return slices.length - 1;
}

export function findWinnerIndex(categories, winner) {
  if (!winner) return -1;
  if (winner.id != null) {
    const byId = categories.findIndex((c) => c.id === winner.id);
    if (byId !== -1) return byId;
  }
  return categories.findIndex((c) => c.name === winner.name);
}

// Total clockwise-negative rotation needed so slice `index` ends under the pointer.
// `jitter` in [-1, 1] lands off-centre within the slice (kept inside it).
export function spinDistanceTo({ slices, index, rotation, turns, jitter = 0 }) {
  const s = slices[index];
  const aim = s.mid + (jitter * s.angle * 0.8) / 2;
  const target = POINTER_ANGLE - aim;
  const delta = mod(rotation - target, TAU);
  return delta + Math.max(0, turns) * TAU;
}
