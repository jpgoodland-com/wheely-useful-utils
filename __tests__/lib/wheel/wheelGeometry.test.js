import { TAU, buildSlices, findWinnerIndex, sliceIndexAt, spinDistanceTo } from "@/lib/wheel/wheelGeometry";

const cats = (weights) => weights.map((w, i) => ({ id: `c${i}`, name: `Cat ${i}`, weight: w }));

describe("wheelGeometry", () => {
  it("builds slices that cover the circle", () => {
    const slices = buildSlices(cats([1, 2, 3, 4]));
    expect(slices).toHaveLength(4);
    expect(slices[3].end).toBeCloseTo(TAU);
    expect(buildSlices(cats([0, 0]))).toEqual([]);
  });

  it("puts the chosen slice under the pointer after the planned spin", () => {
    for (let n = 0; n < 200; n++) {
      const weights = Array.from({ length: 2 + Math.floor(Math.random() * 12) }, () => 0.1 + Math.random() * 5);
      const slices = buildSlices(cats(weights));
      const index = Math.floor(Math.random() * weights.length);
      const rotation = (Math.random() - 0.5) * 100;
      const distance = spinDistanceTo({
        slices,
        index,
        rotation,
        turns: 6 + Math.floor(Math.random() * 4),
        jitter: Math.random() * 2 - 1,
      });
      expect(distance).toBeGreaterThan(0);
      expect(sliceIndexAt(slices, rotation - distance)).toBe(index);
    }
  });

  it("finds winners by id, falling back to name", () => {
    const list = [
      { id: "a", name: "Same" },
      { id: "b", name: "Same" },
    ];
    expect(findWinnerIndex(list, { id: "b", name: "Same" })).toBe(1);
    expect(findWinnerIndex(list, { name: "Same" })).toBe(0);
    expect(findWinnerIndex(list, { id: "zzz", name: "Same" })).toBe(0);
    expect(findWinnerIndex(list, { id: "zzz", name: "Nope" })).toBe(-1);
    expect(findWinnerIndex(list, null)).toBe(-1);
  });
});
