// Draws a game-show host as chunky pixels onto a tiny canvas (scaled up by CSS with pixelated rendering).
// The character is chosen by a host `look` (see hosts.js): a head routine, an outfit routine and a palette.

export const HOST_W = 48;
export const HOST_H = 64;

const BASE_COLORS = {
  outline: "#0f172a",
  suit: "#3b4a63",
  lapel: "#52627d",
  shirt: "#f8fafc",
  tie: "#dc2626",
  pants: "#1f2937",
  shoe: "#020617",
  skin: "#f2c9a0",
  skinShade: "#d9a77a",
  hair: "#e5e7eb",
  hairShade: "#9ca3af",
  mouth: "#7f1d1d",
  mic: "#111827",
  micHead: "#9ca3af",
  shine: "#ffffff",
  blush: "#e8a0a0",
  brow: "#9a7b5a",
  stripe: "#facc15",
  collar: "#0f172a",
  patchRed: "#dc2626",
  patchBlue: "#1d4ed8",
  furLight: "#fff4e6",
  furDark: "#3b2314",
  nose: "#111827",
  band: "#facc15",
  vest: "#0f766e",
  vestLight: "#2dd4bf",
  bib: "#f8fafc",
  bibInk: "#1e293b",
  flask: "#38bdf8",
  shorts: "#1e3a8a",
};

// Colors a host file may set. `sleeve` defaults to the suit, `hand` to the skin; `shoeTrim` is off unless set.
export const PALETTE_KEYS = [...Object.keys(BASE_COLORS), "sleeve", "hand", "shoeTrim"];

export const CLASSIC_LOOK = { head: "hair", outfit: "suit", colors: {} };

const UPPER_ARM = 9;
const FOREARM = 8;

function drawMouth(px, hx, hy, c, pose, oy = 0) {
  if (pose.mouth > 0.6) {
    px(hx - 3, hy + 12 + oy, 6, 3, c.outline);
    px(hx - 2, hy + 14 + oy, 4, 1, c.mouth);
  } else if (pose.mouth > 0.1) {
    px(hx - 2, hy + 13 + oy, 4, 2, c.mouth);
  } else {
    px(hx - 3, hy + 13 + oy, 6, 1, c.mouth);
    px(hx - 4, hy + 12 + oy, 1, 1, c.mouth);
    px(hx + 3, hy + 12 + oy, 1, 1, c.mouth);
  }
}

const HEADS = {
  hair(px, hx, hy, c, pose) {
    px(hx - 7, hy - 2, 14, 5, c.hair);
    px(hx - 8, hy + 1, 3, 8, c.hair);
    px(hx + 5, hy + 1, 3, 8, c.hair);
    px(hx - 6, hy + 3, 12, 13, c.skin);
    px(hx + 3, hy + 4, 3, 12, c.skinShade);
    px(hx - 6, hy + 2, 12, 2, c.hairShade);
    px(hx - 4, hy + 7, 2, 2, c.outline);
    px(hx + 1, hy + 7, 2, 2, c.outline);
    px(hx - 5, hy + 5, 4, 1, c.hairShade);
    px(hx, hy + 5, 4, 1, c.hairShade);
    px(hx - 1, hy + 9, 2, 3, c.skinShade);
    drawMouth(px, hx, hy, c, pose);
  },

  bald(px, hx, hy, c, pose) {
    px(hx - 5, hy + 1, 10, 2, c.skin);
    px(hx - 6, hy + 3, 12, 13, c.skin);
    px(hx + 3, hy + 4, 3, 12, c.skinShade);
    px(hx - 3, hy + 2, 3, 1, c.shine);
    px(hx - 7, hy + 7, 1, 4, c.skinShade);
    px(hx + 6, hy + 7, 1, 4, c.skinShade);
    px(hx - 5, hy + 5, 4, 1, c.brow);
    px(hx, hy + 5, 4, 1, c.brow);
    px(hx - 4, hy + 7, 2, 2, c.outline);
    px(hx + 1, hy + 7, 2, 2, c.outline);
    px(hx - 1, hy + 9, 2, 3, c.skinShade);
    px(hx - 5, hy + 10, 2, 1, c.blush);
    px(hx + 3, hy + 10, 2, 1, c.blush);
    px(hx - 4, hy + 15, 8, 1, c.skinShade);
    drawMouth(px, hx, hy, c, pose);
  },

  fox(px, hx, hy, c, pose) {
    // Ears
    px(hx - 7, hy - 1, 5, 5, c.skin);
    px(hx + 2, hy - 1, 5, 5, c.skin);
    px(hx - 6, hy - 4, 3, 3, c.furDark);
    px(hx + 3, hy - 4, 3, 3, c.furDark);
    px(hx - 5, hy, 2, 3, c.furLight);
    px(hx + 3, hy, 2, 3, c.furLight);
    // Head and cheek tufts
    px(hx - 6, hy + 2, 12, 14, c.skin);
    px(hx + 3, hy + 3, 3, 7, c.skinShade);
    px(hx - 7, hy + 9, 2, 5, c.furLight);
    px(hx + 5, hy + 9, 2, 5, c.furLight);
    // Muzzle and nose
    px(hx - 3, hy + 9, 6, 7, c.furLight);
    px(hx - 1, hy + 9, 2, 2, c.nose);
    // Headband with a knot at the back
    px(hx - 6, hy + 3, 12, 2, c.band);
    px(hx - 9, hy + 4, 3, 2, c.band);
    px(hx - 9, hy + 6, 2, 2, c.band);
    // Eyes
    px(hx - 4, hy + 6, 2, 2, c.outline);
    px(hx + 2, hy + 6, 2, 2, c.outline);
    // Mouth sits inside the muzzle
    if (pose.mouth > 0.6) {
      px(hx - 2, hy + 12, 4, 3, c.outline);
      px(hx - 1, hy + 14, 2, 1, c.mouth);
    } else if (pose.mouth > 0.1) {
      px(hx - 2, hy + 12, 4, 2, c.mouth);
    } else {
      px(hx - 2, hy + 13, 4, 1, c.mouth);
    }
  },
};

const OUTFITS = {
  suit(px, cx, top, c) {
    px(cx - 9, 22 + top, 18, 21 - top, c.suit);
    px(cx - 9, 22 + top, 3, 21 - top, c.lapel);
    px(cx + 6, 22 + top, 3, 21 - top, c.lapel);
    px(cx - 3, 22 + top, 6, 9, c.shirt);
    px(cx - 1, 24 + top, 2, 12, c.tie);
    px(cx - 2, 23 + top, 4, 2, c.tie);
  },

  racing(px, cx, top, c) {
    px(cx - 9, 22 + top, 18, 21 - top, c.suit);
    px(cx - 9, 22 + top, 2, 21 - top, c.stripe);
    px(cx + 7, 22 + top, 2, 21 - top, c.stripe);
    px(cx - 7, 30 + top, 14, 2, c.shirt);
    px(cx, 24 + top, 1, 19 - top, c.lapel);
    px(cx - 4, 22 + top, 8, 2, c.collar);
    px(cx - 6, 25 + top, 4, 3, c.patchRed);
    // Union Jack shoulder patch
    px(cx + 3, 25 + top, 4, 3, c.patchBlue);
    px(cx + 3, 26 + top, 4, 1, c.shirt);
    px(cx + 4, 25 + top, 1, 3, c.shirt);
    px(cx + 3, 26 + top, 4, 1, c.patchRed);
    px(cx + 4, 25 + top, 1, 3, c.patchRed);
    px(cx - 9, 40, 18, 1, c.shirt);
  },

  trail(px, cx, top, c) {
    // Running vest with bib and soft flasks, over navy shorts
    px(cx - 9, 22 + top, 18, 16 - top, c.vest);
    px(cx - 3, 22 + top, 6, 3, c.skin);
    px(cx - 6, 22 + top, 2, 9, c.vestLight);
    px(cx + 4, 22 + top, 2, 9, c.vestLight);
    px(cx - 8, 28 + top, 2, 5, c.flask);
    px(cx + 6, 28 + top, 2, 5, c.flask);
    px(cx - 4, 27 + top, 8, 7, c.bib);
    px(cx - 3, 29 + top, 2, 3, c.bibInk);
    px(cx, 29 + top, 2, 3, c.bibInk);
    px(cx - 4, 27 + top, 1, 1, c.tie);
    px(cx + 3, 27 + top, 1, 1, c.tie);
    px(cx - 9, 38, 18, 8, c.shorts);
    px(cx - 9, 38, 18, 1, c.vestLight);
  },
};

export const HEAD_STYLES = Object.keys(HEADS);
export const OUTFIT_STYLES = Object.keys(OUTFITS);

function drawFoxTail(px, cx, pose, c) {
  const wag = pose.leg >= 0 ? Math.round(2 * Math.sin(pose.leg * Math.PI * 2)) : 0;
  px(cx - 16 + wag, 40, 7, 8, c.skin);
  px(cx - 18 + wag, 34, 5, 8, c.skin);
  px(cx - 15 + wag, 40, 3, 6, c.skinShade);
  px(cx - 19 + wag, 30, 4, 5, c.furLight);
}

export function drawHost(ctx, pose, { facing = -1, look = CLASSIC_LOOK } = {}) {
  if (!ctx) return;
  ctx.clearRect(0, 0, HOST_W, HOST_H);

  const c = { ...BASE_COLORS, ...look.colors };
  c.sleeve = c.sleeve || c.suit;
  c.hand = c.hand || c.skin;

  const px = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    const rx = facing > 0 ? x : HOST_W - x - w;
    ctx.fillRect(Math.round(rx), Math.round(y), w, h);
  };

  const line = (x0, y0, x1, y1, thick, color) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      px(x - thick / 2, y - thick / 2, thick, thick, color);
    }
  };

  const arm = (sx, sy, a1, a2, withMic) => {
    const ex = sx + Math.sin(a1) * UPPER_ARM;
    const ey = sy + Math.cos(a1) * UPPER_ARM;
    const wx = ex + Math.sin(a1 + a2) * FOREARM;
    const wy = ey + Math.cos(a1 + a2) * FOREARM;
    line(sx, sy, ex, ey, 4, c.sleeve);
    line(ex, ey, wx, wy, 4, c.sleeve);
    px(wx - 2, wy - 2, 4, 4, c.hand);
    if (withMic) {
      px(wx - 1, wy - 7, 2, 6, c.mic);
      px(wx - 2, wy - 10, 4, 4, c.micHead);
    }
  };

  const cx = 24 + pose.lean;
  const top = pose.bob;

  if (look.head === "fox") drawFoxTail(px, cx, pose, c);

  // Far arm sits behind the body.
  arm(cx - 9, 25 + top, pose.a1, pose.a2, false);

  // Legs
  const walking = pose.leg >= 0;
  const swing = walking ? 6 * Math.sin(pose.leg * Math.PI * 2) : 0;
  const lift = walking ? 3 * Math.max(0, Math.cos(pose.leg * Math.PI * 2)) : 0;
  const lift2 = walking ? 3 * Math.max(0, -Math.cos(pose.leg * Math.PI * 2)) : 0;
  line(24 - 4, 42, 24 - 4 + swing, 60 - lift, 5, c.pants);
  line(24 + 4, 42, 24 + 4 - swing, 60 - lift2, 5, c.pants);
  px(24 - 4 + swing - 3, 60 - lift, 7, 3, c.shoe);
  px(24 + 4 - swing - 3, 60 - lift2, 7, 3, c.shoe);
  if (c.shoeTrim) {
    px(24 - 4 + swing - 3, 62 - lift, 7, 1, c.shoeTrim);
    px(24 + 4 - swing - 3, 62 - lift2, 7, 1, c.shoeTrim);
  }

  (OUTFITS[look.outfit] || OUTFITS.suit)(px, cx, top, c);

  // Near arm with the mic
  arm(cx + 8, 25 + top, pose.b1, pose.b2, true);

  (HEADS[look.head] || HEADS.hair)(px, cx + Math.round(pose.tilt), 7 + top, c, pose);
}
