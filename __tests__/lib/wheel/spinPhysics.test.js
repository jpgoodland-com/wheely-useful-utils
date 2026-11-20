import { planSnap, planSpin, randomSpinTiming } from "@/lib/wheel/spinPhysics";

const opts = { distance: 40, rampMs: 900, cruiseMs: 600, decelMs: 5000 };

describe("planSpin", () => {
  const plan = planSpin(opts);

  it("lands exactly on the distance", () => {
    expect(plan.angleAt(plan.total)).toBe(40);
    expect(plan.angleAt(plan.total + 5)).toBe(40);
    expect(plan.angleAt(0)).toBe(0);
  });

  it("starts and ends at rest", () => {
    expect(plan.speedAt(0)).toBe(0);
    expect(plan.speedAt(plan.total)).toBe(0);
  });

  it("is monotonic, accelerates, then slows", () => {
    let prev = -1;
    for (let t = 0; t <= plan.total; t += 0.01) {
      const a = plan.angleAt(t);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(plan.speedAt(0.5)).toBeGreaterThan(plan.speedAt(0.1));
    expect(plan.speedAt(1.2)).toBeCloseTo(plan.vMax);
    expect(plan.speedAt(plan.total - 0.5)).toBeLessThan(plan.vMax / 4);
  });

  it("is continuous at phase joins", () => {
    const joins = [0.9, 1.5];
    for (const j of joins) {
      expect(plan.angleAt(j + 1e-7)).toBeCloseTo(plan.angleAt(j - 1e-7), 4);
      expect(plan.speedAt(j + 1e-7)).toBeCloseTo(plan.speedAt(j - 1e-7), 3);
    }
  });

  it("matches numeric integration of speed", () => {
    let sum = 0;
    const dt = 0.0005;
    for (let t = 0; t < plan.total; t += dt) sum += plan.speedAt(t + dt / 2) * dt;
    expect(sum).toBeCloseTo(40, 1);
  });
});

describe("planSnap (reduced motion)", () => {
  it("jumps to the target and holds, with no intermediate rotation", () => {
    const plan = planSnap({ distance: 3.2, holdMs: 600 });
    expect(plan.total).toBeCloseTo(0.6);
    expect(plan.angleAt(0)).toBe(0);
    for (const t of [0.001, 0.2, 0.59, 0.6, 5]) expect(plan.angleAt(t)).toBe(3.2);
    expect(plan.speedAt(0.3)).toBe(0);
    expect(plan.vMax).toBe(0);
  });
});

describe("randomSpinTiming", () => {
  it("stays in range", () => {
    for (let i = 0; i < 50; i++) {
      const t = randomSpinTiming();
      expect(t.turns).toBeGreaterThanOrEqual(6);
      expect(t.turns).toBeLessThanOrEqual(9);
      expect(t.decelMs).toBeGreaterThanOrEqual(4200);
    }
  });

  it("never spins extra turns in reduced motion", () => {
    for (let i = 0; i < 20; i++) {
      const r = randomSpinTiming(Math.random, true);
      expect(r.snap).toBe(true);
      expect(r.turns).toBe(0);
      expect(r.holdMs).toBeLessThan(1000);
    }
  });
});
