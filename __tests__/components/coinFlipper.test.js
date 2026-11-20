/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { CoinFlipper } from "@/components/CoinFlipper";

// jsdom has no Web Animations API. Each fake animation finishes when the test
// says so, which lets a toss be held in the air or superseded.
let pending;

function installAnimate() {
  pending = [];
  Element.prototype.animate = jest.fn(function () {
    let finish;
    const finished = new Promise((resolve) => {
      finish = resolve;
    });
    const anim = { finished, cancel: jest.fn(() => finish()) };
    pending.push(finish);
    return anim;
  });
}

async function landAll() {
  await act(async () => {
    for (const finish of pending.splice(0)) finish();
  });
}

const slots = (container) => [...container.querySelectorAll('[data-part="coin"]')].map((el) => el.closest(".slot"));
const angles = (container) =>
  [...container.querySelectorAll('[data-part="coin"]')].map((el) => Number(/rotateX\((-?\d+)deg\)/.exec(el.style.transform)[1]));

beforeEach(() => {
  installAnimate();
  window.matchMedia = jest.fn(() => ({ matches: false }));
});

afterEach(() => {
  delete Element.prototype.animate;
});

describe("CoinFlipper layout", () => {
  it("reserves headroom for the toss arc on the main flipper", () => {
    const { container } = render(<CoinFlipper count={1} />);
    expect(container.querySelector(".coins")).toHaveClass("tossable");
  });

  it("does not reserve it for the editor's turn-in-place preview", () => {
    const { container } = render(<CoinFlipper rotation={0} />);
    expect(container.querySelector(".coins")).not.toHaveClass("tossable");
  });
});

describe("CoinFlipper toss", () => {
  it("plans and records only the coins that are rendered after the count goes down", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.5); // no jitter
    const ref = createRef();
    const { container, rerender } = render(<CoinFlipper ref={ref} count={10} />);
    rerender(<CoinFlipper ref={ref} count={5} />);

    let done;
    act(() => {
      done = ref.current.toss(Array(10).fill("tails"));
    });
    // flight, coin, shadow and glow for each of the 5 rendered coins
    expect(Element.prototype.animate).toHaveBeenCalledTimes(5 * 4);
    // The stagger is planned for 5 coins (100ms apart), not 10 (90ms apart).
    const delays = Element.prototype.animate.mock.calls.map(([, opts]) => opts.delay);
    expect(Math.max(...delays)).toBe(400);
    await landAll();
    await act(() => done);

    // Coins 6-10 never flew, so they must not pick up a result.
    rerender(<CoinFlipper ref={ref} count={10} />);
    expect(angles(container)).toEqual([180, 180, 180, 180, 180, 0, 0, 0, 0, 0]);
    Math.random.mockRestore();
  });

  it("lands every coin on its result", async () => {
    const ref = createRef();
    const { container } = render(<CoinFlipper ref={ref} count={3} />);
    let done;
    act(() => {
      done = ref.current.toss(["tails", "heads", "tails"]);
    });
    await landAll();
    await act(() => done);
    expect(angles(container)).toEqual([180, 0, 180]);
  });

  it("keeps the faces of coins left out of a smaller toss", async () => {
    const ref = createRef();
    const { container, rerender } = render(<CoinFlipper ref={ref} count={3} />);

    let done;
    act(() => {
      done = ref.current.toss(["tails", "tails", "tails"]);
    });
    await landAll();
    await act(() => done);

    rerender(<CoinFlipper ref={ref} count={1} />);
    act(() => {
      done = ref.current.toss(["heads"]);
    });
    await landAll();
    await act(() => done);

    rerender(<CoinFlipper ref={ref} count={3} />);
    expect(angles(container)).toEqual([0, 180, 180]);
  });

  it("raises coins above the row during a toss and lowers them when they land", async () => {
    const ref = createRef();
    const { container } = render(<CoinFlipper ref={ref} count={2} />);
    let done;
    act(() => {
      done = ref.current.toss(["heads", "tails"]);
    });
    for (const slot of slots(container)) expect(slot.style.zIndex).toBe("5");

    await landAll();
    await act(() => done);
    for (const slot of slots(container)) expect(slot.style.zIndex).toBe("");
  });

  it("does not leave coins raised when a newer toss supersedes one and exits early", async () => {
    const ref = createRef();
    const { container } = render(<CoinFlipper ref={ref} count={2} />);
    let first;
    act(() => {
      first = ref.current.toss(["heads", "tails"]);
    });
    expect(slots(container)[0].style.zIndex).toBe("5");

    // A newer toss with nothing to animate: the first run returns early without
    // committing sides, so this reset is the only thing that clears the flags.
    await act(async () => {
      await ref.current.toss([]);
    });
    await act(() => first);

    for (const slot of slots(container)) expect(slot.style.zIndex).toBe("");
  });

  it("still lands every coin on its result when animating throws", async () => {
    const ref = createRef();
    const { container } = render(<CoinFlipper ref={ref} count={3} />);
    let calls = 0;
    const realAnimate = Element.prototype.animate;
    Element.prototype.animate = jest.fn(function (...args) {
      // Fail partway through the second coin, after the first is in the air.
      if (++calls === 6) throw new Error("bad keyframe");
      return realAnimate.apply(this, args);
    });

    await act(async () => {
      await expect(ref.current.toss(["tails", "heads", "tails"])).resolves.toBeUndefined();
    });

    expect(angles(container)).toEqual([180, 0, 180]);
    for (const slot of slots(container)) expect(slot.style.zIndex).toBe("");
  });

  it("uses the short turn-in-place animation when reduced motion is preferred", async () => {
    window.matchMedia = jest.fn(() => ({ matches: true }));
    const ref = createRef();
    const { container } = render(<CoinFlipper ref={ref} count={1} />);
    let done;
    act(() => {
      done = ref.current.toss(["tails"]);
    });
    // coin turn plus slot fade, and no flight
    expect(Element.prototype.animate).toHaveBeenCalledTimes(2);
    expect(slots(container)[0].style.zIndex).toBe("");
    await landAll();
    await act(() => done);
    expect(angles(container)).toEqual([180]);
  });
});
