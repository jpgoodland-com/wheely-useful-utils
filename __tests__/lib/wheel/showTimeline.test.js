import { PHASE, createShow, showDurations, waitingPoseFor } from "@/lib/wheel/showTimeline";

describe("createShow", () => {
  it("runs the phases in order when the result is already known", () => {
    const show = createShow();
    const d = showDurations(false);
    show.start(0);
    show.setResult(10, 6000);
    const order = [];
    for (let t = 0; t < 12000; t += 50) {
      const s = show.update(t);
      if (order[order.length - 1] !== s.phase) order.push(s.phase);
    }
    expect(order).toEqual([
      PHASE.WALK_IN, PHASE.WINDUP, PHASE.PUSH, PHASE.STEP_BACK, PHASE.WAITING, PHASE.REACT, PHASE.WALK_OUT, PHASE.DONE,
    ]);
    expect(d.walk).toBeGreaterThan(0);
  });

  it("starts the spin clock at the push, not at the click", () => {
    const show = createShow();
    const d = showDurations(false);
    show.start(0);
    show.setResult(10, 5000);
    expect(show.update(d.walk + d.windup - 1).spinMs).toBe(-1);
    expect(show.update(d.walk + d.windup + 100).spinMs).toBeCloseTo(100, 0);
  });

  it("waits for a slow fetch before winding up", () => {
    const show = createShow();
    const d = showDurations(false);
    show.start(0);
    expect(show.update(d.walk + 3000).phase).toBe(PHASE.AWAIT_RESULT);
    show.setResult(d.walk + 3000, 5000);
    expect(show.update(d.walk + 3000).phase).toBe(PHASE.WINDUP);
  });

  it("uses a shorter walk-in when asked, so a repeat spin starts sooner", () => {
    const show = createShow({ walkInMs: 300 });
    show.start(0);
    show.setResult(0, 5000);
    expect(show.update(299).phase).toBe(PHASE.WALK_IN);
    expect(show.update(301).phase).toBe(PHASE.WINDUP);
    expect(show.update(300 + showDurations(false).windup + 100).spinMs).toBeCloseTo(100, 0);
  });

  it("shrugs and walks off on failure, with or without a result", () => {
    const show = createShow();
    show.start(0);
    show.fail(100);
    expect(show.update(100).phase).toBe(PHASE.ERROR);
    expect(show.update(100 + showDurations(false).error + 10).phase).toBe(PHASE.WALK_OUT);
    expect(show.update(10000).done).toBe(true);
  });

  it("has no walking in reduced motion", () => {
    const show = createShow({ reduced: true });
    show.start(0);
    show.setResult(0, 2000);
    expect(show.update(0).phase).toBe(PHASE.WAITING);
  });
});

describe("waitingPoseFor", () => {
  it("picks poses by wheel speed", () => {
    expect(waitingPoseFor(0.9, 5000)).toBe("waveCrowd");
    expect(waitingPoseFor(0.4, 3000)).toBe("crossArms");
    expect(waitingPoseFor(0.1, 3000)).toBe("leanIn");
    expect(waitingPoseFor(0.05, 800)).toBe("holdBreath");
  });
});
