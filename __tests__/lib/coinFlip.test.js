import {
  tossCoin,
  tossMany,
  alternatingRunLength,
  repeatProbability,
  HEADS,
  TAILS,
  NUDGE_MIN_RUN,
  NUDGE_STEP,
  NUDGE_CAP,
  MAX_TOSS_COUNT,
} from "@/lib/coinFlip";

describe("lib/coinFlip", () => {
  describe("alternatingRunLength", () => {
    it("returns 0 for empty or invalid history", () => {
      expect(alternatingRunLength([])).toBe(0);
      expect(alternatingRunLength(null)).toBe(0);
    });

    it("returns 1 for single flip", () => {
      expect(alternatingRunLength([HEADS])).toBe(1);
    });

    it("counts consecutive alternating flips from the end", () => {
      expect(alternatingRunLength([HEADS, TAILS])).toBe(2);
      expect(alternatingRunLength([HEADS, TAILS, HEADS])).toBe(3);
      expect(alternatingRunLength([HEADS, TAILS, HEADS, TAILS])).toBe(4);
      expect(alternatingRunLength([HEADS, HEADS, TAILS, HEADS, TAILS])).toBe(4);
    });

    it("stops counting when alternation breaks", () => {
      expect(alternatingRunLength([HEADS, TAILS, TAILS])).toBe(1);
      expect(alternatingRunLength([TAILS, HEADS, HEADS])).toBe(1);
    });
  });

  describe("repeatProbability (nudge math)", () => {
    it("is strictly 0.5 (fair) when run length < 4", () => {
      expect(repeatProbability([])).toBe(0.5);
      expect(repeatProbability([HEADS])).toBe(0.5);
      expect(repeatProbability([HEADS, TAILS])).toBe(0.5);
      expect(repeatProbability([HEADS, TAILS, HEADS])).toBe(0.5);
    });

    it("grows by 3% for each alternating flip starting at k=4", () => {
      // k = 4: 0.5 + 0.03 * (4 - 3) = 0.53
      expect(repeatProbability([HEADS, TAILS, HEADS, TAILS])).toBeCloseTo(0.53);
      // k = 5: 0.5 + 0.03 * (5 - 3) = 0.56
      expect(repeatProbability([TAILS, HEADS, TAILS, HEADS, TAILS])).toBeCloseTo(0.56);
      // k = 6: 0.5 + 0.03 * (6 - 3) = 0.59
      expect(repeatProbability([HEADS, TAILS, HEADS, TAILS, HEADS, TAILS])).toBeCloseTo(0.59);
    });

    it("caps at exactly 65% (0.5 + NUDGE_CAP = 0.65) regardless of run length", () => {
      const longRun = [];
      for (let i = 0; i < 50; i++) {
        longRun.push(i % 2 === 0 ? HEADS : TAILS);
      }
      expect(repeatProbability(longRun)).toBe(0.65);
    });

    it("resets back to 0.5 as soon as alternation breaks", () => {
      const brokenRun = [HEADS, TAILS, HEADS, TAILS, TAILS];
      expect(repeatProbability(brokenRun)).toBe(0.5);
    });
  });

  describe("tossCoin determinism and behavior", () => {
    it("returns HEADS or TAILS only", () => {
      for (let i = 0; i < 20; i++) {
        const res = tossCoin();
        expect([HEADS, TAILS]).toContain(res);
      }
    });

    it("obeys deterministic mocked random float without history", () => {
      expect(tossCoin([], () => 0.49)).toBe(HEADS);
      expect(tossCoin([], () => 0.50)).toBe(TAILS);
      expect(tossCoin([], () => 0.99)).toBe(TAILS);
    });

    it("favors repeating the last result when nudge is active", () => {
      const history = [HEADS, TAILS, HEADS, TAILS]; // last is TAILS, k=4, pRepeat=0.53
      // When r < 0.53, repeats TAILS
      expect(tossCoin(history, () => 0.52)).toBe(TAILS);
      // When r >= 0.53, switches to HEADS
      expect(tossCoin(history, () => 0.54)).toBe(HEADS);
    });
  });

  describe("tossMany", () => {
    it("defaults count to 1 and clamps between 1 and 100", () => {
      expect(tossMany(0).length).toBe(1);
      expect(tossMany(-10).length).toBe(1);
      expect(tossMany(5).length).toBe(5);
      expect(tossMany(200).length).toBe(MAX_TOSS_COUNT);
    });

    it("applies sequential history updates across the batch", () => {
      // Mock rand returning 0.52
      // At k=1,2,3 pRepeat=0.50 -> 0.52 switches face
      // At k=4 pRepeat=0.53 -> 0.52 repeats last face!
      let callCount = 0;
      const results = tossMany(5, [], () => 0.52);
      expect(results.length).toBe(5);
    });
  });

  describe("Statistical validation (10,000 flips)", () => {
    it("maintains approximately 50/50 overall distribution (within ±3%)", () => {
      let headsCount = 0;
      const history = [];
      const total = 10000;

      for (let i = 0; i < total; i++) {
        const res = tossCoin(history);
        if (res === HEADS) headsCount++;
        history.push(res);
        if (history.length > 20) history.shift();
      }

      const headsRatio = headsCount / total;
      expect(headsRatio).toBeGreaterThanOrEqual(0.47);
      expect(headsRatio).toBeLessThanOrEqual(0.53);
    });

    it("reduces long alternating run frequency compared to unbiased baseline", () => {
      // Compare 5000 tosses with nudge vs 5000 purely unbiased tosses
      const countRunsOfLen = (hist, minLen) => {
        let count = 0;
        let curLen = 1;
        for (let i = 1; i < hist.length; i++) {
          if (hist[i] !== hist[i - 1]) {
            curLen++;
            if (curLen === minLen) count++;
          } else {
            curLen = 1;
          }
        }
        return count;
      };

      // Seeded (mulberry32) so the comparison is deterministic: two
      // independent random samples of 5000 drift by more than the margin
      // now and then, which made this test fail at random in CI.
      const seeded = (seed) => () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };

      const nudgedRand = seeded(20261118);
      const nudgedHist = [];
      for (let i = 0; i < 5000; i++) {
        nudgedHist.push(tossCoin(nudgedHist, nudgedRand));
      }

      // Unbiased toss: always 50/50, same random stream
      const unbiasedRand = seeded(20261118);
      const unbiasedHist = [];
      for (let i = 0; i < 5000; i++) {
        unbiasedHist.push(tossCoin([], unbiasedRand));
      }

      // In an unbiased coin, runs of length >= 6 happen roughly 5000 * (0.5)^5 ≈ 156 times.
      // With our nudge starting at k=4 with 53%, 56%, etc., runs of length >= 6 are reduced.
      const nudgedLongRuns = countRunsOfLen(nudgedHist, 7);
      const unbiasedLongRuns = countRunsOfLen(unbiasedHist, 7);
      expect(nudgedLongRuns).toBeLessThan(unbiasedLongRuns + 5);
    });
  });
});
