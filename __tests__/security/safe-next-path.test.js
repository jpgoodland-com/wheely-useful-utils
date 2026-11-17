import { safeNextPath } from "@/lib/url";

describe("safeNextPath (post-login redirect)", () => {
  it.each([
    "/features/capacity-planner",
    "/features/capacity-planner/4f9c2a7e-1b3d-4c5e-8f6a-0b1c2d3e4f5a?from=2026-10-05&to=2026-12-27",
    "/features/capacity-planner/aggregate?ids=a%2Cb",
  ])("allows same-site path %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "features/x",
    "/x\nSet-Cookie: a=b",
    "/<script>",
    "",
    null,
    undefined,
    `/${"a".repeat(600)}`,
  ])("rejects %j", (path) => {
    expect(safeNextPath(path)).toBe("/dashboard");
  });
});
