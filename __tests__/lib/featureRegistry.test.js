import { FEATURES, getVisibleFeatures } from "@/lib/featureRegistry";

describe("lib/featureRegistry", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("has unique ids", () => {
    const ids = FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(["development", "production"])("always lists the donate card last (%s)", (env) => {
    process.env.NODE_ENV = env;
    const visible = getVisibleFeatures();
    expect(visible.at(-1).id).toBe("donate");
  });

  it("keeps pinned cards last even when features are added after them", () => {
    const features = [
      { id: "a", status: "live" },
      { id: "donate", status: "live", pinnedLast: true },
      { id: "b", status: "live" },
      { id: "c", status: "dev" },
    ];
    process.env.NODE_ENV = "production";
    expect(getVisibleFeatures(features).map((f) => f.id)).toEqual(["a", "b", "donate"]);
    process.env.NODE_ENV = "development";
    expect(getVisibleFeatures(features).map((f) => f.id)).toEqual(["a", "b", "c", "donate"]);
  });

  it("shows the capacity planner card in production", () => {
    process.env.NODE_ENV = "production";
    expect(getVisibleFeatures().map((f) => f.id)).toContain("capacity-planner");
  });
});
