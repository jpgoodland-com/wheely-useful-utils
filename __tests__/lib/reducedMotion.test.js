/** @jest-environment jsdom */
import { prefersReducedMotion, reducedMotionQuery } from "@/lib/reducedMotion";

const original = window.matchMedia;

afterEach(() => {
  window.matchMedia = original;
});

describe("prefersReducedMotion", () => {
  it("follows the media query", () => {
    window.matchMedia = jest.fn(() => ({ matches: true }));
    expect(prefersReducedMotion()).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");

    window.matchMedia = jest.fn(() => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
  });

  it("is false when matchMedia is missing, not a function, or throws", () => {
    delete window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
    expect(reducedMotionQuery()).toBeNull();

    window.matchMedia = {};
    expect(prefersReducedMotion()).toBe(false);

    window.matchMedia = () => {
      throw new Error("unsupported");
    };
    expect(prefersReducedMotion()).toBe(false);
    expect(reducedMotionQuery()).toBeNull();
  });
});
