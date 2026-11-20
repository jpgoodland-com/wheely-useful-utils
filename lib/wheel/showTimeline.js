// Sequences the host around one spin. Time is passed in, so it is deterministic and testable.
// The wheel's spin clock (spinMs) starts when the push begins.

export const PHASE = {
  IDLE: "idle",
  WALK_IN: "walkIn",
  AWAIT_RESULT: "awaitResult",
  WINDUP: "windup",
  PUSH: "push",
  STEP_BACK: "stepBack",
  WAITING: "waiting",
  REACT: "react",
  ERROR: "error",
  WALK_OUT: "walkOut",
  DONE: "done",
};

export function showDurations(reduced) {
  return reduced
    ? { walk: 0, windup: 0, push: 0, stepBack: 0, react: 600, error: 600 }
    : { walk: 1400, windup: 500, push: 380, stepBack: 450, react: 1800, error: 1500 };
}

// `walkInMs` shortens the walk-in when the host is already near the wheel (e.g. spinning again).
export function createShow({ reduced = false, walkInMs } = {}) {
  const d = showDurations(reduced);
  d.walkIn = reduced ? 0 : Math.max(0, walkInMs ?? d.walk);
  let phase = PHASE.IDLE;
  let phaseStart = 0;
  let spinStart = null;
  let spinTotalMs = 0;
  let resultReady = false;
  let failed = false;

  function enter(next, now) {
    phase = next;
    phaseStart = now;
    if (next === PHASE.PUSH) spinStart = now;
  }

  function advance(now) {
    for (let guard = 0; guard < 12; guard++) {
      const t = now - phaseStart;
      switch (phase) {
        case PHASE.WALK_IN:
          if (failed) return enter(PHASE.ERROR, now);
          if (t < d.walkIn) return;
          enter(resultReady ? PHASE.WINDUP : PHASE.AWAIT_RESULT, phaseStart + d.walkIn);
          break;
        case PHASE.AWAIT_RESULT:
          if (failed) return enter(PHASE.ERROR, now);
          if (!resultReady) return;
          enter(PHASE.WINDUP, now);
          break;
        case PHASE.WINDUP:
          if (t < d.windup) return;
          enter(PHASE.PUSH, phaseStart + d.windup);
          break;
        case PHASE.PUSH:
          if (t < d.push) return;
          enter(PHASE.STEP_BACK, phaseStart + d.push);
          break;
        case PHASE.STEP_BACK:
          if (t < d.stepBack) return;
          enter(PHASE.WAITING, phaseStart + d.stepBack);
          break;
        case PHASE.WAITING:
          if (now - spinStart < spinTotalMs) return;
          enter(PHASE.REACT, spinStart + spinTotalMs);
          break;
        case PHASE.REACT:
          if (t < d.react) return;
          enter(PHASE.WALK_OUT, phaseStart + d.react);
          break;
        case PHASE.ERROR:
          if (t < d.error) return;
          enter(PHASE.WALK_OUT, phaseStart + d.error);
          break;
        case PHASE.WALK_OUT:
          if (t < d.walk) return;
          enter(PHASE.DONE, phaseStart + d.walk);
          return;
        default:
          return;
      }
    }
  }

  return {
    start(now) {
      spinStart = null;
      resultReady = false;
      failed = false;
      enter(PHASE.WALK_IN, now);
    },
    setResult(now, totalMs) {
      spinTotalMs = totalMs;
      resultReady = true;
      advance(now);
    },
    fail(now) {
      failed = true;
      advance(now);
    },
    update(now) {
      advance(now);
      return {
        phase,
        phaseMs: now - phaseStart,
        phaseDuration: d,
        spinMs: spinStart == null ? -1 : Math.max(0, now - spinStart),
        spinning: spinStart != null && now - spinStart < spinTotalMs,
        done: phase === PHASE.DONE,
      };
    },
  };
}

// Picks the waiting-pose family from how fast the wheel is turning.
export function waitingPoseFor(speedFraction, remainingMs) {
  if (remainingMs < 1200) return "holdBreath";
  if (speedFraction > 0.6) return "waveCrowd";
  if (speedFraction > 0.3) return "crossArms";
  return "leanIn";
}
