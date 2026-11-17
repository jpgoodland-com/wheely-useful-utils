// Pure animation math for the coin toss. The outcome is decided by the server;
// everything here only decides how the coin travels before landing on it.

export const TOSS_TIMES = {
  crouch: 0.08,
  apex: 0.46,
  land: 0.8,
  hop: 0.885,
  touch: 0.945,
  tap: 0.975,
};

const T = TOSS_TIMES;

export function restAngle(side) {
  return side === "tails" ? 180 : 0;
}

/** Total end-over-end rotation in degrees: whole turns plus the move from one side to the other. */
export function spinTotal(from, to, turns) {
  const delta = (restAngle(to) - restAngle(from) + 360) % 360;
  return turns * 360 + delta;
}

export function planToss({ index, count, rand = Math.random }) {
  const multi = count > 1;
  const stagger = multi ? Math.min(100, 900 / count) : 0;
  const jitter = multi ? (rand() - 0.5) * 30 : 0;
  return {
    delay: Math.max(0, Math.round(index * stagger + jitter)),
    duration: Math.round(multi ? 1150 + rand() * 200 : 1700),
    turns: multi ? 3 + Math.floor(rand() * 3) : 6 + Math.floor(rand() * 3),
    drift: (rand() - 0.5) * 0.24,
    tilt: (rand() - 0.5) * 24,
    wobble: (rand() - 0.5) * 36,
  };
}

const spin = (x, y = 0) => `rotateY(${y}deg) rotateX(${x}deg)`;

export function buildTossKeyframes({ size, riseFactor, from, to, plan }) {
  const rise = size * riseFactor;
  const sway = plan.drift * size;
  const start = restAngle(from);
  const end = start + spinTotal(from, to, plan.turns);
  const preLand = end - 18;
  const apexFraction = (T.apex - T.crouch) / (T.land - T.crouch);
  const apexAngle = start + (preLand - start) * apexFraction;

  const fly = (offset, x, y, sx, sy, z, easing) => ({
    offset,
    transform: `translate(${x}px, ${y}px) scale(${sx}, ${sy}) rotate(${z}deg)`,
    ...(easing ? { easing } : {}),
  });

  const flight = [
    fly(0, 0, 0, 1, 1, 0, "ease-out"),
    fly(T.crouch, 0, size * 0.06, 1.05, 0.93, 0, "cubic-bezier(0.12, 0.75, 0.35, 1)"),
    fly(T.apex, sway, -rise, 1.3, 1.3, plan.tilt, "cubic-bezier(0.55, 0, 0.9, 0.5)"),
    fly(T.land, 0, 0, 1.05, 0.95, 0, "cubic-bezier(0.2, 0.7, 0.4, 1)"),
    fly(T.hop, 0, -rise * 0.08, 1, 1, 0, "cubic-bezier(0.5, 0, 0.9, 0.6)"),
    fly(T.touch, 0, 0, 1.02, 0.98, 0, "ease-out"),
    fly(T.tap, 0, -rise * 0.02, 1, 1, 0, "ease-in"),
    fly(1, 0, 0, 1, 1, 0),
  ];

  const coin = [
    { offset: 0, transform: spin(start) },
    { offset: T.crouch, transform: spin(start), easing: "linear" },
    { offset: T.apex, transform: spin(apexAngle, plan.wobble), easing: "linear" },
    { offset: T.land, transform: spin(preLand), easing: "ease-out" },
    { offset: T.hop, transform: spin(end + 7), easing: "ease-in-out" },
    { offset: T.touch, transform: spin(end - 3), easing: "ease-in-out" },
    { offset: T.tap, transform: spin(end + 1), easing: "ease-in-out" },
    { offset: 1, transform: spin(end) },
  ];

  const shade = (offset, scale, opacity) => ({
    offset,
    transform: `scale(${scale})`,
    opacity,
  });
  const shadow = [
    shade(0, 1, 1),
    shade(T.crouch, 1.05, 1),
    shade(T.apex, 0.5, 0.3),
    shade(T.land, 1.05, 1),
    shade(T.hop, 0.9, 0.7),
    shade(T.touch, 1, 1),
    shade(T.tap, 0.95, 0.9),
    shade(1, 1, 1),
  ];

  // Landing glow: flashes just as the coin touches down, then fades out. The
  // easing is per keyframe, so the offsets stay in step with the other tracks.
  const glowAt = (offset, opacity, scale, easing) => ({
    offset,
    opacity,
    transform: `scale(${scale})`,
    ...(easing ? { easing } : {}),
  });
  const glow = [
    glowAt(0, 0, 0.9),
    glowAt(T.land - 0.01, 0, 0.9, "ease-out"),
    glowAt(T.land + 0.02, 0.85, 1, "ease-out"),
    glowAt(1, 0, 1.35),
  ];

  return { flight, coin, shadow, glow, end };
}

/** Reduced motion: no travel, just a quarter-second turn to the result plus a fade dip on the outer slot. */
export function buildReducedKeyframes({ from, to }) {
  const start = restAngle(from);
  const end = start + spinTotal(from, to, 0);
  return {
    coin: [
      { offset: 0, transform: spin(start) },
      { offset: 1, transform: spin(end) },
    ],
    fade: [{ opacity: 1 }, { opacity: 0.35, offset: 0.5 }, { opacity: 1 }],
  };
}
