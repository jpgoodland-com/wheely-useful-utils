import {
  TOSS_TIMES,
  buildReducedKeyframes,
  buildTossKeyframes,
  planToss,
  restAngle,
  spinTotal,
} from "@/lib/coinToss";

const rotX = (t) => Number(/rotateX\((-?[\d.]+)deg\)/.exec(t)[1]);

describe("spinTotal", () => {
  it.each([
    ["heads", "heads", 0],
    ["heads", "tails", 180],
    ["tails", "heads", 180],
    ["tails", "tails", 0],
  ])("%s -> %s adds %i degrees on top of whole turns", (from, to, extra) => {
    expect(spinTotal(from, to, 5)).toBe(5 * 360 + extra);
  });
});

describe("planToss", () => {
  const mid = () => 0.5;

  it("keeps a single toss unstaggered and long", () => {
    const plan = planToss({ index: 0, count: 1, rand: mid });
    expect(plan.delay).toBe(0);
    expect(plan.duration).toBe(1700);
    expect(plan.turns).toBeGreaterThanOrEqual(6);
  });

  it("flicks multi tosses in quick succession, all done within ~2.2s", () => {
    for (const count of [5, 10]) {
      for (let i = 0; i < count; i++) {
        const lo = planToss({ index: i, count, rand: () => 0 });
        const hi = planToss({ index: i, count, rand: () => 0.999 });
        expect(lo.delay).toBeGreaterThanOrEqual(0);
        expect(hi.delay + hi.duration).toBeLessThan(2300);
        expect(hi.turns).toBeLessThan(6);
      }
    }
  });

  it("never starts the next coin before the previous one, on average", () => {
    const delays = Array.from({ length: 10 }, (_, i) => planToss({ index: i, count: 10, rand: mid }).delay);
    expect([...delays].sort((a, b) => a - b)).toEqual(delays);
  });
});

describe("buildTossKeyframes", () => {
  const plan = { turns: 4, drift: 0.05, tilt: 6, wobble: 10, delay: 0, duration: 1500 };

  it.each([
    ["heads", "heads"],
    ["heads", "tails"],
    ["tails", "heads"],
    ["tails", "tails"],
  ])("ends exactly on %s -> %s", (from, to) => {
    const { coin, flight, end } = buildTossKeyframes({ size: 100, riseFactor: 1, from, to, plan });
    expect(((end % 360) + 360) % 360).toBe(restAngle(to));
    expect(rotX(coin[coin.length - 1].transform)).toBe(end);
    expect(coin[coin.length - 1].offset).toBe(1);
    expect(flight[flight.length - 1].transform).toContain("translate(0px, 0px)");
  });

  it("has ascending offsets for every track", () => {
    const kf = buildTossKeyframes({ size: 100, riseFactor: 1, from: "heads", to: "tails", plan });
    for (const track of [kf.flight, kf.coin, kf.shadow, kf.glow]) {
      const offsets = track.map((f) => f.offset);
      expect(offsets[0]).toBe(0);
      expect(offsets[offsets.length - 1]).toBe(1);
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    }
  });

  it("flashes the glow as the coin lands, timed from TOSS_TIMES.land", () => {
    const { glow } = buildTossKeyframes({ size: 100, riseFactor: 1, from: "heads", to: "tails", plan });
    const peak = glow.reduce((a, b) => (b.opacity > a.opacity ? b : a));
    expect(peak.opacity).toBeGreaterThan(0);
    expect(peak.offset).toBeGreaterThan(TOSS_TIMES.land);
    expect(peak.offset).toBeLessThan(TOSS_TIMES.hop);
    for (const f of glow.filter((g) => g.offset < TOSS_TIMES.land)) expect(f.opacity).toBe(0);
    expect(glow[glow.length - 1].opacity).toBe(0);
  });

  it("rises to the apex and settles back to the ground", () => {
    const { flight } = buildTossKeyframes({ size: 100, riseFactor: 1.5, from: "heads", to: "heads", plan });
    const apex = flight.find((f) => f.offset === TOSS_TIMES.apex);
    expect(apex.transform).toContain("-150px");
  });
});

describe("buildReducedKeyframes", () => {
  it("only turns to the result without travelling", () => {
    const { coin, fade } = buildReducedKeyframes({ from: "heads", to: "tails" });
    expect(rotX(coin[1].transform)).toBe(180);
    expect(JSON.stringify(coin)).not.toContain("translate");
    expect(fade[1].opacity).toBeLessThan(1);
  });
});
