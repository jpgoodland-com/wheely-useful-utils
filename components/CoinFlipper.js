"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  buildReducedKeyframes,
  buildTossKeyframes,
  planToss,
  restAngle,
} from "@/lib/coinToss";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import styles from "./CoinFlipper.module.css";

const EDGE_LAYERS = [-0.75, -0.375, 0, 0.375, 0.75];

function renderFaceContent(face) {
  if (!face) return null;
  if (face.type === "image") {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={face.value}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        className={styles.imageFace}
      />
    );
  }
  if (face.type === "emoji") {
    return <span className={styles.emojiFace}>{face.value}</span>;
  }
  return <span className={styles.textFace}>{face.value}</span>;
}

const part = (slot, name) => slot.querySelector(`[data-part="${name}"]`);

/**
 * Renders `count` coins. Two ways to turn them:
 * - `rotation` (degrees): a single coin follows the prop with a CSS transition (editor preview).
 * - `ref.toss(results)`: flicks every coin into the air and resolves once all have landed on
 *   the given sides. The outcome is always supplied by the caller, never chosen here.
 */
export const CoinFlipper = forwardRef(function CoinFlipper(
  { coin, count = 1, isFlipping = false, rotation, onFlip },
  ref
) {
  const headsColor = coin?.headsColor || "#3b82f6";
  const tailsColor = coin?.tailsColor || "#ec4899";
  const rimColor = coin?.rimColor || "#e5e5ec";
  const styleVariant =
    coin?.style === "retro"
      ? styles.styleRetro
      : coin?.style === "modern"
      ? styles.styleModern
      : styles.styleClassic;
  const manual = rotation !== undefined;
  const slotCount = Math.max(1, count);

  const [sides, setSides] = useState([]);
  const sidesRef = useRef([]);
  const slotsRef = useRef([]);
  const animsRef = useRef([]);
  const runRef = useRef(0);

  // Stops any running toss and lowers every coin back into the row. Every path
  // that ends or abandons a toss goes through here, so no coin is left raised
  // above the others.
  const resetCoins = useCallback(() => {
    for (const a of animsRef.current) a.cancel();
    animsRef.current = [];
    for (const slot of slotsRef.current) {
      if (slot) {
        slot.style.zIndex = "";
      }
    }
  }, []);

  // Once React has committed the resting transforms, the held animation end-states can go.
  useLayoutEffect(() => {
    resetCoins();
  }, [sides, resetCoins]);

  useEffect(
    () => () => {
      runRef.current += 1;
      resetCoins();
    },
    [resetCoins]
  );

  useImperativeHandle(
    ref,
    () => ({
      async toss(results) {
        const run = ++runRef.current;
        resetCoins();
        const reduced = prefersReducedMotion();
        // slotsRef keeps null entries for unmounted coins, so count from the prop.
        const total = Math.min(results.length, slotCount);
        const finished = [];
        // Every coin shares one --size. Read it once, before the loop writes any
        // styles, so starting a 10x toss doesn't force a layout per coin.
        const firstSlot = slotsRef.current[0];
        const size = (firstSlot && part(firstSlot, "coin")?.offsetWidth) || 120;

        try {
          for (let i = 0; i < total; i++) {
            const slot = slotsRef.current[i];
            const flight = slot && part(slot, "flight");
            const coinEl = slot && part(slot, "coin");
            const shadowEl = slot && part(slot, "shadow");
            const glowEl = slot && part(slot, "glow");
            if (!coinEl || !flight || !shadowEl || !glowEl || typeof coinEl.animate !== "function") continue;

            const from = sidesRef.current[i] || "heads";
            const to = results[i];
            const run1 = (el, keyframes, options) => {
              const anim = el.animate(keyframes, { fill: "both", ...options });
              animsRef.current.push(anim);
              finished.push(anim.finished.catch(() => {}));
              return anim;
            };

            if (reduced) {
              const kf = buildReducedKeyframes({ from, to });
              run1(coinEl, kf.coin, { duration: 260, easing: "ease-in-out" });
              run1(slot, kf.fade, { duration: 260, easing: "ease-in-out" });
              continue;
            }

            const plan = planToss({ index: i, count: total });
            const kf = buildTossKeyframes({
              size,
              riseFactor: total > 1 ? 1.5 : 1.15,
              from,
              to,
              plan,
            });
            const options = { duration: plan.duration, delay: plan.delay };

            slot.style.zIndex = "5";
            run1(flight, kf.flight, options);
            run1(coinEl, kf.coin, options);
            run1(shadowEl, kf.shadow, options);
            glowEl.style.setProperty("--glow-color", to === "heads" ? headsColor : tailsColor);
            run1(glowEl, kf.glow, options);
          }

          await Promise.all(finished);
        } catch {
          // Animating failed (for example a browser rejecting a keyframe). The
          // result is already decided, so land the coins on it without animation.
        }
        if (run !== runRef.current) return;

        // Coins left out of this toss keep their faces (10x, then 1x, then 10x again).
        const next = [...sidesRef.current];
        for (let i = 0; i < total; i++) next[i] = results[i];
        sidesRef.current = next;
        setSides(next);
      },
    }),
    [resetCoins, slotCount, headsColor, tailsColor]
  );

  const sideAt = (i) => sides[i] || "heads";

  return (
    <div className={styles.container}>
      <div
        // Only a coin that can toss needs headroom for its arc. The editor's
        // preview (manual) turns in place, so it skips the padding.
        className={`${styles.coins} ${manual ? "" : styles.tossable}`}
        data-density={slotCount === 1 ? "single" : slotCount <= 5 ? "few" : "many"}
        onClick={!isFlipping && onFlip ? onFlip : undefined}
        role="button"
        tabIndex={0}
        aria-label={slotCount > 1 ? "Coin flipper, click to flip all coins" : "Coin flipper, click to flip"}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !isFlipping && onFlip) {
            e.preventDefault();
            onFlip();
          }
        }}
        style={{
          "--heads-color": headsColor,
          "--tails-color": tailsColor,
          "--rim-color": rimColor,
        }}
      >
        {Array.from({ length: slotCount }, (_, i) => {
          const angle = manual ? rotation : restAngle(sideAt(i));
          return (
            <div
              key={i}
              className={styles.slot}
              ref={(el) => {
                slotsRef.current[i] = el;
              }}
            >
              <div className={styles.stage}>
                <div className={styles.flight} data-part="flight">
                  <div
                    className={`${styles.coin} ${manual ? styles.manual : ""}`}
                    data-part="coin"
                    style={{ transform: `rotateX(${angle}deg)` }}
                  >
                    {EDGE_LAYERS.map((k) => (
                      <div key={k} className={styles.edge} style={{ "--k": k }} />
                    ))}
                    <div className={`${styles.face} ${styles.heads} ${styleVariant}`}>
                      {renderFaceContent(coin?.heads)}
                    </div>
                    <div className={`${styles.face} ${styles.tails} ${styleVariant}`}>
                      {renderFaceContent(coin?.tails)}
                    </div>
                  </div>
                </div>
                <div className={styles.glow} data-part="glow" />
              </div>
              <div className={styles.shadow} data-part="shadow" />
            </div>
          );
        })}
      </div>
    </div>
  );
});
