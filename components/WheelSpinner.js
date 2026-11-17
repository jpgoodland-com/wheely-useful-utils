"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./WheelSpinner.module.css";
import { planSnap, planSpin, randomSpinTiming } from "@/lib/wheel/spinPhysics";
import { TAU, findWinnerIndex, sliceIndexAt, spinDistanceTo } from "@/lib/wheel/wheelGeometry";
import { createWheelRenderer, styleCategories } from "@/lib/wheel/drawWheel";
import { HOST_W, HOST_H, drawHost } from "@/lib/wheel/drawHost";
import { NEUTRAL_POSE, blendPose, poseTarget } from "@/lib/wheel/hostPoses";
import { PHASE, createShow, waitingPoseFor } from "@/lib/wheel/showTimeline";
import { createQuotePicker } from "@/lib/wheel/hostQuotes";
import { FALLBACK_HOST, loadHosts, pickHost, readSavedHostId, saveHostId } from "@/lib/wheel/hostConfig";
import { prefersReducedMotion, reducedMotionQuery } from "@/lib/reducedMotion";

const IDLE_SPOT = { x: 76, y: 66 };
const PUSH_SPOT = { x: 66, y: 44 };
const WAIT_SPOT = { x: 74, y: 54 };
const BULB_COUNT = 24;
const IDLE_FRAME_MS = 66;
const IDLE_SLEEP_MS = 45000;
const WALK_MS_PER_UNIT = 58;

const ease = (t) => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};
const lerpSpot = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const rand = (min, max) => min + Math.random() * (max - min);

function newSim() {
  return {
    raf: 0,
    lastDraw: 0,
    clock: 0,
    rotation: 0,
    rotationBase: 0,
    chase: 0,
    flap: 0,
    lastSliceIdx: -2,
    active: false,
    locked: false,
    reduced: false,
    visible: true,
    lastActivity: 0,
    walkFrom: { ...IDLE_SPOT },
    wake: null,
    finish: null,
    show: null,
    plan: null,
    result: null,
    winner: null,
    winnerIndex: -1,
    winnerIdxAtSpin: -1,
    lastWinnerKey: null,
    flags: {},
    latestCategories: [],
    pending: false,
    pose: { ...NEUTRAL_POSE },
    hostPos: { ...IDLE_SPOT },
    fidget: { until: 0, name: "idle" },
    nextFidget: 0,
    nextIdleQuote: 0,
    talkUntil: 0,
    bubbleTimer: 0,
    mounted: false,
  };
}

export function WheelSpinner({ categories, onSpinComplete, onSpinFinished, wheelName = "" }) {
  const wheelCanvasRef = useRef(null);
  const hostCanvasRef = useRef(null);
  const hostElRef = useRef(null);
  const simRef = useRef(null);
  const rendererRef = useRef(null);
  const pickerRef = useRef(null);
  const bubbleMsRef = useRef(2800);
  const callbacksRef = useRef({ onSpinFinished });
  const wheelNameRef = useRef(wheelName);
  const [busy, setBusy] = useState(false);
  const [bubble, setBubble] = useState(null);
  const [hosts, setHosts] = useState([FALLBACK_HOST]);
  const [defaultHostId, setDefaultHostId] = useState(FALLBACK_HOST.id);
  const [hostsReady, setHostsReady] = useState(false);
  const [savedHostId, setSavedHostId] = useState(readSavedHostId);
  const host = pickHost(hosts, savedHostId, defaultHostId);
  const lookRef = useRef(host.look);

  useEffect(() => {
    let cancelled = false;
    loadHosts().then(({ hosts: loaded, defaultId, problems }) => {
      if (cancelled) return;
      if (problems.length > 0) console.warn(`Wheel hosts: ${problems.join("; ")}`);
      setHosts(loaded);
      setDefaultHostId(defaultId);
      setHostsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    callbacksRef.current = { onSpinFinished };
    wheelNameRef.current = wheelName;
  }, [onSpinFinished, wheelName]);

  useEffect(() => {
    lookRef.current = host.look;
    pickerRef.current = createQuotePicker(host.quotes);
    bubbleMsRef.current = host.bubbleMs;
    const s = simRef.current;
    if (s && !s.active) s.nextIdleQuote = performance.now() + 800;
    if (s && s.wake) s.wake();
  }, [host]);

  useEffect(() => {
    const s = (simRef.current = newSim());
    s.mounted = true;
    s.reduced = prefersReducedMotion();
    s.lastActivity = performance.now();
    s.nextFidget = 4000;
    s.nextIdleQuote = 3000;

    const wheelCanvas = wheelCanvasRef.current;
    const hostCanvas = hostCanvasRef.current;
    if (!wheelCanvas || !hostCanvas) return undefined;

    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const renderer = createWheelRenderer(wheelCanvas, { scale });
    rendererRef.current = renderer;
    hostCanvas.width = HOST_W;
    hostCanvas.height = HOST_H;
    const hostCtx = hostCanvas.getContext("2d");
    if (hostCtx) hostCtx.imageSmoothingEnabled = false;

    function say(category, ctx, t) {
      const picker = pickerRef.current;
      if (!picker) return;
      const text = picker(category, ctx);
      if (!text) return;
      const ms = bubbleMsRef.current;
      setBubble(text);
      s.talkUntil = t + Math.min(ms, 1800);
      clearTimeout(s.bubbleTimer);
      s.bubbleTimer = setTimeout(() => {
        if (s.mounted) setBubble(null);
      }, ms);
    }

    function randomName(excludeName) {
      const names = s.latestCategories.map((c) => c.name).filter((n) => n !== excludeName);
      return names.length > 0 ? names[Math.floor(Math.random() * names.length)] : "";
    }

    function quoteCtx() {
      const w = s.winner;
      return {
        winner: w ? w.name : undefined,
        random: randomName(w ? w.name : undefined),
        wheel: wheelNameRef.current,
        wins: w ? (w.selectedCount || 0) + 1 : undefined,
      };
    }

    function hostTarget(st) {
      if (!st) return { spot: IDLE_SPOT, snap: false, name: null };
      const d = st.phaseDuration;
      switch (st.phase) {
        case PHASE.WALK_IN:
          return { spot: lerpSpot(s.walkFrom, PUSH_SPOT, d.walkIn ? ease(st.phaseMs / d.walkIn) : 1), snap: true, name: "walk" };
        case PHASE.AWAIT_RESULT:
          return { spot: PUSH_SPOT, snap: false, name: "crossArms" };
        case PHASE.WINDUP:
          return { spot: PUSH_SPOT, snap: false, name: "windup" };
        case PHASE.PUSH:
          return { spot: PUSH_SPOT, snap: false, name: "push" };
        case PHASE.STEP_BACK:
          return { spot: lerpSpot(PUSH_SPOT, WAIT_SPOT, d.stepBack ? ease(st.phaseMs / d.stepBack) : 1), snap: true, name: "idle" };
        case PHASE.WAITING:
          return { spot: WAIT_SPOT, snap: false, name: null };
        case PHASE.REACT:
          return { spot: WAIT_SPOT, snap: false, name: "cheer" };
        case PHASE.ERROR:
          return { spot: WAIT_SPOT, snap: false, name: "shrug" };
        case PHASE.WALK_OUT:
          return { spot: lerpSpot(WAIT_SPOT, IDLE_SPOT, d.walk ? ease(st.phaseMs / d.walk) : 1), snap: true, name: "walk" };
        default:
          return { spot: IDLE_SPOT, snap: false, name: "idle" };
      }
    }

    // Ends the current show. Also used when a new spin cuts the walk-out short.
    function finishShow(t) {
      s.active = false;
      s.locked = false;
      s.rotation %= TAU;
      s.winnerIndex = -1;
      if (s.pending) {
        s.pending = false;
        renderer.setCategories(s.latestCategories);
      }
      s.nextFidget = t + rand(4000, 8000);
      s.nextIdleQuote = t + rand(9000, 14000);
      s.lastActivity = t;
      if (s.mounted) setBusy(false);
    }
    s.finish = finishShow;

    function step(t, dt) {
      let st = null;
      let speedFraction = 0;
      let remainingMs = 0;

      if (s.active) {
        st = s.show.update(t);
        const f = s.flags;

        if (st.spinMs >= 0 && s.plan) {
          const totalMs = s.plan.total * 1000;
          const sec = Math.min(st.spinMs, totalMs) / 1000;
          s.rotation = s.rotationBase - s.plan.angleAt(sec);
          const speed = s.plan.speedAt(sec);
          speedFraction = speed / s.plan.vMax;
          remainingMs = totalMs - st.spinMs;
          s.chase += speed * dt * (BULB_COUNT / TAU) * 0.6;

          if (!f.started) {
            f.started = true;
            say("spinStart", quoteCtx(), t);
          }
          if (st.spinning) {
            if (!f.waitingSaid && st.spinMs > 2200 && remainingMs > 3200) {
              f.waitingSaid = true;
              say("waiting", quoteCtx(), t);
            }
            if (!f.slowingSaid && speedFraction < 0.28 && remainingMs > 1500) {
              f.slowingSaid = true;
              say("slowing", quoteCtx(), t);
            }
          } else if (!f.stopped) {
            f.stopped = true;
            s.locked = false;
            if (s.mounted) setBusy(false);
            s.rotation = s.rotationBase - s.plan.distance;
            s.winnerIndex = s.winnerIdxAtSpin;
            if (!s.reduced) renderer.burst();
            const key = s.winner ? (s.winner.id ?? s.winner.name) : null;
            const repeat = key != null && key === s.lastWinnerKey;
            s.lastWinnerKey = key;
            say(repeat ? "repeatWinner" : "result", quoteCtx(), t);
            if (s.result && callbacksRef.current.onSpinFinished) callbacksRef.current.onSpinFinished(s.result);
          }
        }

        if (st.phase === PHASE.ERROR && !f.errored) {
          f.errored = true;
          s.locked = false;
          if (s.mounted) setBusy(false);
          say("error", quoteCtx(), t);
        }

        if (st.done) finishShow(t);
      } else {
        if (t > s.nextFidget && !s.reduced) {
          s.fidget = { until: t + 1300, name: Math.random() < 0.6 ? "waveCrowd" : "shrug" };
          s.nextFidget = t + rand(4000, 8000);
        }
        if (t > s.nextIdleQuote) {
          s.nextIdleQuote = t + rand(9000, 14000);
          say("idle", quoteCtx(), t);
        }
      }

      const idx = sliceIndexAt(renderer.getSlices(), s.rotation);
      if (s.lastSliceIdx !== -2 && idx !== s.lastSliceIdx && st && st.spinning && !s.reduced) s.flap = 1;
      s.lastSliceIdx = idx;
      s.flap *= Math.exp(-dt * 10);

      const spinning = !!(st && st.spinning);
      const bulbMode = s.reduced ? "static" : spinning ? "spin" : s.winnerIndex >= 0 ? "winner" : "idle";
      renderer.draw(
        {
          rotation: s.rotation,
          time: s.reduced ? 0 : s.clock,
          bulbMode,
          chase: s.chase,
          flap: s.flap,
          winnerIndex: s.winnerIndex,
          winnerPulse: s.winnerIndex >= 0 ? 1 : 0,
        },
        dt
      );

      const target = hostTarget(st);
      let poseName = target.name;
      if (!poseName) {
        poseName = waitingPoseFor(speedFraction, remainingMs);
        if (poseName === "crossArms" && Math.floor((st ? st.spinMs : 0) / 1500) % 2 === 1) poseName = "checkWatch";
      } else if (!st && s.fidget.until > t) {
        poseName = s.fidget.name;
      }
      const talking = s.talkUntil > t;
      s.pose = blendPose(s.pose, poseTarget(poseName, s.reduced ? 0 : s.clock, { talking }), 1 - Math.exp(-dt * 14));
      if (target.snap) s.hostPos = { ...target.spot };
      else {
        const k = 1 - Math.exp(-dt * 10);
        s.hostPos = { x: s.hostPos.x + (target.spot.x - s.hostPos.x) * k, y: s.hostPos.y + (target.spot.y - s.hostPos.y) * k };
      }
      const el = hostElRef.current;
      if (el) {
        el.style.left = `${s.hostPos.x}%`;
        el.style.top = `${s.hostPos.y}%`;
      }
      drawHost(hostCtx, s.pose, { facing: -1, look: lookRef.current });
    }

    function frame() {
      const t = performance.now();
      const calm = t > s.fidget.until + 500 && t > s.talkUntil + 500;
      if (!s.active && calm && (!s.visible || t - s.lastActivity > IDLE_SLEEP_MS)) {
        s.raf = 0;
        return;
      }
      s.raf = requestAnimationFrame(frame);
      if (!s.active && t - s.lastDraw < IDLE_FRAME_MS) return;
      const dt = Math.min(Math.max(t - s.lastDraw, 0), 50) / 1000;
      s.lastDraw = t;
      s.clock += dt;
      step(t, dt);
    }

    function wake() {
      const t = performance.now();
      s.lastActivity = t;
      if (s.raf) return;
      s.lastDraw = t;
      s.nextFidget = Math.max(s.nextFidget, t + 3000);
      s.nextIdleQuote = Math.max(s.nextIdleQuote, t + 4000);
      s.raf = requestAnimationFrame(frame);
    }
    s.wake = wake;

    const mq = reducedMotionQuery();
    const onMotionChange = (e) => {
      s.reduced = !!e.matches;
    };
    if (mq && typeof mq.addEventListener === "function") mq.addEventListener("change", onMotionChange);

    let observer = null;
    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver((entries) => {
        s.visible = entries[entries.length - 1].isIntersecting;
        if (s.visible) wake();
      });
      observer.observe(wheelCanvas);
    }

    s.lastDraw = performance.now();
    s.raf = requestAnimationFrame(frame);

    return () => {
      s.mounted = false;
      if (mq && typeof mq.removeEventListener === "function") mq.removeEventListener("change", onMotionChange);
      if (observer) observer.disconnect();
      cancelAnimationFrame(s.raf);
      clearTimeout(s.bubbleTimer);
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const s = simRef.current;
    const renderer = rendererRef.current;
    if (!s) return;
    s.latestCategories = styleCategories(categories);
    if (s.active) {
      s.pending = true;
      return;
    }
    if (renderer) renderer.setCategories(s.latestCategories);
    if (s.wake) s.wake();
  }, [categories]);

  const wake = () => {
    const s = simRef.current;
    if (s && s.wake) s.wake();
  };

  const spin = async () => {
    const s = simRef.current;
    const renderer = rendererRef.current;
    if (!s || !renderer || s.locked || categories.length === 0) return;

    const t0 = performance.now();
    if (s.active) s.finish(t0);
    renderer.clearConfetti();

    const reduced = s.reduced;
    // The host is already on stage after a spin, so a repeat spin has a shorter walk.
    s.walkFrom = { ...s.hostPos };
    const distance = Math.hypot(PUSH_SPOT.x - s.walkFrom.x, PUSH_SPOT.y - s.walkFrom.y);
    const walkInMs = Math.min(Math.max(distance * WALK_MS_PER_UNIT, 300), 1400);

    s.locked = true;
    s.flags = {};
    s.result = null;
    s.winner = null;
    s.plan = null;
    s.winnerIndex = -1;
    s.pending = false;
    s.show = createShow({ reduced, walkInMs });
    s.show.start(t0);
    s.active = true;
    wake();
    setBubble(null);
    setBusy(true);

    try {
      const res = await onSpinComplete(1);
      if (!s.mounted) return;
      const winners = (res && res.winners) || [];
      const winner = winners[winners.length - 1];
      s.result = res;
      s.winner = winner || null;

      // The saved spin is the truth. If a collaborator changed the wheel in another tab, redraw the
      // slices from the server's categories and still animate to the winner.
      let idx = findWinnerIndex(s.latestCategories, winner);
      if (idx === -1 && res && Array.isArray(res.newCategories)) {
        const fresh = styleCategories(res.newCategories);
        const freshIdx = findWinnerIndex(fresh, winner);
        if (freshIdx !== -1) {
          s.latestCategories = fresh;
          renderer.setCategories(fresh);
          idx = freshIdx;
        }
      }

      const timing = randomSpinTiming(Math.random, reduced);
      let plan;
      if (idx === -1) {
        // Winner is nowhere in the slices: show the result without a spin rather than claiming a failure.
        plan = planSnap({ distance: 0, holdMs: 400 });
        s.winnerIdxAtSpin = -1;
      } else {
        const toWinner = spinDistanceTo({
          slices: renderer.getSlices(),
          index: idx,
          rotation: s.rotation,
          turns: timing.turns,
          jitter: rand(-1, 1),
        });
        plan = timing.snap
          ? planSnap({ distance: toWinner, holdMs: timing.holdMs })
          : planSpin({ distance: toWinner, rampMs: timing.rampMs, cruiseMs: timing.cruiseMs, decelMs: timing.decelMs });
        s.winnerIdxAtSpin = idx;
      }
      s.plan = plan;
      s.rotationBase = s.rotation;
      s.show.setResult(performance.now(), plan.total * 1000);
    } catch (err) {
      console.error(err);
      if (s.mounted && s.show) s.show.fail(performance.now());
    }
  };

  return (
    <div
      style={{ width: "100%", maxWidth: "500px", margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center" }}
      onPointerEnter={wake}
      onPointerMove={wake}
      onPointerDown={wake}
      onFocus={wake}
    >
      <div className={styles.stage} data-testid="wheel-stage">
        <canvas ref={wheelCanvasRef} className={styles.wheelCanvas} aria-hidden="true" />
        <div ref={hostElRef} className={styles.host} aria-hidden="true" style={hostsReady ? undefined : { visibility: "hidden" }}>
          <canvas ref={hostCanvasRef} className={styles.hostCanvas} />
          {bubble && (
            <div className={styles.bubble} data-testid="host-bubble">
              {bubble}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 flex gap-4 align-center justify-center p-4 glass-panel" style={{ width: "100%", padding: "1rem", flexWrap: "wrap" }}>
        {hosts.length > 1 && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
            Host
            <select
              className="form-input"
              style={{ padding: "0.5rem 0.75rem", fontSize: "0.9rem", width: "auto" }}
              value={host.id}
              disabled={busy}
              title={host.tagline}
              onChange={(e) => {
                setSavedHostId(e.target.value);
                saveHostId(e.target.value);
              }}
            >
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="btn btn-primary"
          style={{ fontSize: "1.25rem", flex: 1 }}
          onClick={spin}
          disabled={busy || categories.length === 0}
        >
          {busy ? "Spinning..." : "SPIN IT"}
        </button>
      </div>
    </div>
  );
}
