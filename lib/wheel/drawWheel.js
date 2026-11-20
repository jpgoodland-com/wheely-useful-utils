import { TAU, buildSlices } from "./wheelGeometry";

export const WHEEL_SIZE = 500;
const C = WHEEL_SIZE / 2;
const R = 196;
const RIM_OUTER = 232;
const RIM_INNER = R + 6;
const BULB_COUNT = 24;
const BULB_RADIUS = 219;

const FALLBACK_COLORS = ["#3b82f6", "#ec4899", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#f43f5e"];
const CONFETTI_COLORS = ["#fde047", "#f472b6", "#60a5fa", "#34d399", "#ffffff", "#fb923c"];

export function styleCategories(categories) {
  return categories.map((c, i) => ({ ...c, color: c.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length] }));
}

function fitLabel(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

export function createWheelRenderer(canvas, { scale = 1, rng = Math.random } = {}) {
  const ctx = canvas.getContext("2d");
  canvas.width = WHEEL_SIZE * scale;
  canvas.height = WHEEL_SIZE * scale;

  const layer = document.createElement("canvas");
  layer.width = WHEEL_SIZE * scale;
  layer.height = WHEEL_SIZE * scale;
  const layerCtx = layer.getContext("2d");

  let slices = [];
  let confetti = [];

  function setCategories(styled) {
    slices = buildSlices(styled);
    if (!layerCtx) return;
    layerCtx.setTransform(scale, 0, 0, scale, 0, 0);
    layerCtx.clearRect(0, 0, WHEEL_SIZE, WHEEL_SIZE);
    if (slices.length === 0) return;

    const fontPx = styled.length > 24 ? 10 : styled.length > 12 ? 12 : 14;
    styled.forEach((cat, i) => {
      const s = slices[i];
      layerCtx.beginPath();
      layerCtx.moveTo(C, C);
      layerCtx.arc(C, C, R, s.start, s.end);
      layerCtx.closePath();
      layerCtx.fillStyle = cat.color;
      layerCtx.fill();
      layerCtx.lineWidth = 2;
      layerCtx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      layerCtx.stroke();

      layerCtx.save();
      layerCtx.translate(C, C);
      layerCtx.rotate(s.mid);
      layerCtx.textAlign = "right";
      layerCtx.textBaseline = "middle";
      layerCtx.font = `bold ${fontPx}px Inter, sans-serif`;
      layerCtx.fillStyle = "#ffffff";
      layerCtx.shadowColor = "rgba(0, 0, 0, 0.8)";
      layerCtx.shadowBlur = 4;
      layerCtx.fillText(fitLabel(layerCtx, String(cat.name ?? ""), R - 52), R - 18, 0);
      layerCtx.restore();
    });
  }

  function burst() {
    confetti = [];
    for (let i = 0; i < 90; i++) {
      const angle = -Math.PI / 2 + (rng() - 0.5) * 2.2;
      const speed = 160 + rng() * 260;
      confetti.push({
        x: C + (rng() - 0.5) * 120,
        y: C - R + 30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: rng() * TAU,
        vs: (rng() - 0.5) * 12,
        size: 4 + rng() * 5,
        color: CONFETTI_COLORS[Math.floor(rng() * CONFETTI_COLORS.length)],
        life: 2.6 + rng() * 1.2,
      });
    }
  }

  function clearConfetti() {
    confetti = [];
  }

  function drawBulbs(mode, time, chase) {
    for (let k = 0; k < BULB_COUNT; k++) {
      const a = (k / BULB_COUNT) * TAU - Math.PI / 2;
      const x = C + Math.cos(a) * BULB_RADIUS;
      const y = C + Math.sin(a) * BULB_RADIUS;
      let on;
      if (mode === "static") on = true;
      else if (mode === "spin") on = (k + Math.floor(chase)) % 3 === 0;
      else if (mode === "winner") on = Math.floor(time * 7) % 2 === 0 ? true : k % 2 === 0;
      else on = (k + Math.floor(time * 1.6)) % 2 === 0;

      if (on) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, 12);
        g.addColorStop(0, "rgba(253, 224, 71, 0.95)");
        g.addColorStop(1, "rgba(253, 224, 71, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, TAU);
      ctx.fillStyle = on ? "#fff7c2" : "#7c5a10";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
      ctx.stroke();
    }
  }

  function drawPointer(flap) {
    ctx.save();
    ctx.translate(C, 20);
    ctx.rotate(flap * 0.45);
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.lineTo(15, 0);
    ctx.lineTo(0, 54);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, 54);
    g.addColorStop(0, "#fde047");
    g.addColorStop(1, "#d97706");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#1e293b";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 2, 5, 0, TAU);
    ctx.fillStyle = "#1e293b";
    ctx.fill();
    ctx.restore();
  }

  function draw({ rotation, time, bulbMode, chase, flap, winnerIndex, winnerPulse }, dt) {
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, WHEEL_SIZE, WHEEL_SIZE);

    const glow = ctx.createRadialGradient(C, C, R, C, C, RIM_OUTER + 18);
    glow.addColorStop(0, "rgba(236, 72, 153, 0.35)");
    glow.addColorStop(1, "rgba(236, 72, 153, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(C, C, RIM_OUTER + 18, 0, TAU);
    ctx.fill();

    const rim = ctx.createLinearGradient(0, 0, WHEEL_SIZE, WHEEL_SIZE);
    rim.addColorStop(0, "#fde68a");
    rim.addColorStop(0.5, "#b45309");
    rim.addColorStop(1, "#fbbf24");
    ctx.beginPath();
    ctx.arc(C, C, RIM_OUTER, 0, TAU);
    ctx.moveTo(C + RIM_INNER, C);
    ctx.arc(C, C, RIM_INNER, 0, TAU, true);
    ctx.fillStyle = rim;
    ctx.fill("evenodd");
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1e293b";
    ctx.stroke();

    drawBulbs(bulbMode, time, chase);

    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(rotation);
    ctx.drawImage(layer, -C, -C, WHEEL_SIZE, WHEEL_SIZE);
    ctx.restore();

    if (winnerIndex >= 0 && winnerIndex < slices.length && winnerPulse > 0) {
      const s = slices[winnerIndex];
      ctx.beginPath();
      ctx.moveTo(C, C);
      ctx.arc(C, C, R, rotation + s.start, rotation + s.end);
      ctx.closePath();
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.12 + 0.18 * (0.5 + 0.5 * Math.sin(time * 9))) * winnerPulse})`;
      ctx.fill();
    }

    const hub = ctx.createRadialGradient(C - 5, C - 5, 2, C, C, 24);
    hub.addColorStop(0, "#fde68a");
    hub.addColorStop(1, "#b45309");
    ctx.beginPath();
    ctx.arc(C, C, 24, 0, TAU);
    ctx.fillStyle = hub;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#1e293b";
    ctx.stroke();

    drawPointer(flap);

    if (confetti.length > 0) {
      confetti = confetti.filter((p) => p.life > 0 && p.y < WHEEL_SIZE + 20);
      for (const p of confetti) {
        p.vy += 520 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - 0.6 * dt;
        p.spin += p.vs * dt;
        p.life -= dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.globalAlpha = Math.min(1, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
    }
  }

  return { setCategories, draw, burst, clearConfetti, getSlices: () => slices };
}
