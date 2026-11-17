// Pose parameters for the pixel-art host. Angles are radians from "arm hanging down",
// positive swings toward the direction he faces; a2 is the forearm bend on top of a1.
// `a*` is the far arm, `b*` the near arm that holds the mic.

export const HOST_POSE_KEYS = ["bob", "lean", "leg", "a1", "a2", "b1", "b2", "mouth", "tilt"];

export const NEUTRAL_POSE = { bob: 0, lean: 0, leg: -1, a1: 0.12, a2: 0.15, b1: 0.2, b2: 1.1, mouth: 0, tilt: 0 };

const STATIC_POSES = {
  idle: {},
  windup: { lean: -2, a1: -1.5, a2: 0.1, b1: -1.2, b2: 0.2 },
  push: { lean: 3, a1: 1.7, a2: 0.1, b1: 1.6, b2: 0.15 },
  crossArms: { a1: 0.5, a2: 2.3, b1: 0.5, b2: -2.1 },
  checkWatch: { a1: 0.3, a2: 0.2, b1: 0.5, b2: 2.4, tilt: 1 },
  holdBreath: { lean: 1, a1: 0.55, a2: 2.7, b1: 0.6, b2: -2.5 },
  leanIn: { lean: 3, bob: 2, a1: 0.5, a2: 0.3, b1: 0.6, b2: 0.2 },
  shrug: { a1: -1.0, a2: -0.9, b1: 1.0, b2: -0.9, tilt: 2 },
};

export function poseTarget(name, t, { talking = false } = {}) {
  const p = { ...NEUTRAL_POSE, ...(STATIC_POSES[name] || {}) };

  switch (name) {
    case "walk":
      p.leg = (t * 2.4) % 1;
      p.a1 = 0.7 * Math.sin(p.leg * Math.PI * 2);
      p.b1 = -0.7 * Math.sin(p.leg * Math.PI * 2);
      p.a2 = 0.2;
      p.b2 = 0.9;
      p.bob = Math.abs(Math.sin(p.leg * Math.PI * 2)) > 0.85 ? 1 : 0;
      break;
    case "waveCrowd":
      p.a1 = -2.6;
      p.a2 = -0.3 + 0.55 * Math.sin(t * 11);
      p.bob = Math.sin(t * 6) > 0.6 ? 1 : 0;
      break;
    case "cheer":
      p.a1 = -2.6 - 0.15 * Math.sin(t * 14);
      p.a2 = -0.3;
      p.b1 = 2.6 + 0.15 * Math.sin(t * 14);
      p.b2 = 0.3;
      p.bob = Math.sin(t * 12) > 0 ? 2 : 0;
      break;
    case "crossArms":
      p.bob = Math.sin(t * 5) > 0.5 ? 1 : 0;
      break;
    case "idle":
      p.bob = Math.sin(t * 2.2) > 0.7 ? 1 : 0;
      break;
    default:
      break;
  }

  if (talking) p.mouth = Math.sin(t * 16) > 0 ? 1 : 0.35;
  return p;
}

export function blendPose(current, target, k) {
  const out = {};
  for (const key of HOST_POSE_KEYS) {
    const from = current[key] ?? target[key];
    // Walk phase and mouth snap; everything else eases.
    out[key] = key === "leg" || key === "mouth" ? target[key] : from + (target[key] - from) * k;
  }
  return out;
}
