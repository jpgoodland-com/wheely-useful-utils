/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WheelSpinner } from "@/components/WheelSpinner";

const mkHost = (id, name, result) => ({
  name,
  tagline: `${name} tagline`,
  look: { head: "bald", outfit: "suit", colors: {} },
  quotes: { result: [result] },
});
const hostFiles = {
  "/hosts/index.json": { default: "ace", hosts: ["ace", "fox", "chip"], sharedQuotes: "/hosts/shared-quotes.json" },
  "/hosts/shared-quotes.json": { quotes: { idle: ["shared idle"] } },
  "/hosts/ace.json": mkHost("ace", "Ace", "ace wins {winner}"),
  "/hosts/fox.json": mkHost("fox", "Fox", "fox wins {winner}"),
  "/hosts/chip.json": mkHost("chip", "Chip", "chip wins {winner}"),
};
const serveHosts = (files = hostFiles, log = []) =>
  jest.fn(async (url) => {
    log.push(url);
    return url in files ? { ok: true, json: async () => files[url] } : { ok: false };
  });
const flush = () => act(async () => {});

const cats = [
  { id: "a", name: "Adam", weight: 1, selectedCount: 0 },
  { id: "b", name: "<img src=x onerror=alert(1)>", weight: 1, selectedCount: 0 },
  { id: "c", name: "Cleo", weight: 1, selectedCount: 0 },
];

function fakeCtx() {
  const g = { addColorStop: jest.fn() };
  return new Proxy(
    {},
    {
      get: (t, k) => (k in t ? t[k] : k === "createRadialGradient" || k === "createLinearGradient" ? () => g : k === "measureText" ? () => ({ width: 10 }) : jest.fn()),
      set: (t, k, v) => ((t[k] = v), true),
    }
  );
}

let now;
let rafCbs;

beforeEach(() => {
  jest.useFakeTimers();
  now = 1000;
  rafCbs = [];
  jest.spyOn(performance, "now").mockImplementation(() => now);
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => rafCbs.push(cb));
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  HTMLCanvasElement.prototype.getContext = jest.fn(() => fakeCtx());
  window.matchMedia = jest.fn(() => ({ matches: false }));
  global.fetch = serveHosts();
});

afterEach(() => {
  window.localStorage.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function tick(ms, step = 16) {
  for (let spent = 0; spent < ms; spent += step) {
    now += step;
    const cbs = rafCbs;
    rafCbs = [];
    act(() => cbs.forEach((cb) => cb(now)));
  }
}

function tickUntil(done, maxMs, seen) {
  for (let spent = 0; spent < maxMs && !done(); spent += 16) {
    tick(16);
    if (seen) {
      const bubble = screen.queryByTestId("host-bubble");
      if (bubble) seen.add(bubble.textContent);
    }
  }
}

const quoteHostFiles = {
  ...hostFiles,
  "/hosts/ace.json": {
    ...hostFiles["/hosts/ace.json"],
    quotes: { result: ["RESULT_LINE {winner}"], error: ["ERROR_LINE"], idle: ["IDLE_LINE"] },
  },
};

describe("WheelSpinner", () => {
  it("spins once per click, reveals the result when the wheel stops, then re-enables", async () => {
    const onSpinComplete = jest.fn(async () => ({ winners: [cats[0]], newCategories: cats }));
    const onSpinFinished = jest.fn();
    render(<WheelSpinner categories={cats} onSpinComplete={onSpinComplete} onSpinFinished={onSpinFinished} />);
    tick(50);

    const button = screen.getByRole("button", { name: /spin it/i });
    await act(async () => button.click());
    expect(onSpinComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toBeDisabled();

    tick(3000);
    expect(onSpinFinished).not.toHaveBeenCalled();

    tick(12000);
    expect(onSpinFinished).toHaveBeenCalledTimes(1);
    expect(onSpinFinished.mock.calls[0][0].winners[0].name).toBe("Adam");
    expect(screen.getByRole("button", { name: /spin it/i })).toBeEnabled();
  });

  it("shrugs and re-enables when the spin request fails", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const onSpinComplete = jest.fn(async () => {
      throw new Error("nope");
    });
    render(<WheelSpinner categories={cats} onSpinComplete={onSpinComplete} onSpinFinished={jest.fn()} />);
    tick(50);
    await act(async () => screen.getByRole("button").click());
    tick(8000);
    expect(screen.getByRole("button", { name: /spin it/i })).toBeEnabled();
  });

  it("renders a winner name containing HTML as plain text in the bubble", async () => {
    const evil = cats[1];
    const onSpinComplete = jest.fn(async () => ({ winners: [evil], newCategories: cats }));
    const { container } = render(<WheelSpinner categories={cats} onSpinComplete={onSpinComplete} onSpinFinished={jest.fn()} />);
    tick(50);
    await act(async () => screen.getByRole("button").click());
    tick(14000);
    expect(container.querySelector("img")).toBeNull();
  });

  it("disables the button with no categories and cancels its frame loop on unmount", () => {
    const { unmount } = render(<WheelSpinner categories={[]} onSpinComplete={jest.fn()} onSpinFinished={jest.fn()} />);
    expect(screen.getByRole("button")).toBeDisabled();
    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it("loads the hosts from /hosts/index.json and selects the default", async () => {
    const urls = [];
    global.fetch = serveHosts(hostFiles, urls);
    render(<WheelSpinner categories={cats} onSpinComplete={jest.fn()} onSpinFinished={jest.fn()} />);
    await flush();
    const select = screen.getByRole("combobox", { name: /host/i });
    expect(select).toHaveValue("ace");
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ["ace", "Ace"],
      ["fox", "Fox"],
      ["chip", "Chip"],
    ]);
    expect(urls).toEqual(expect.arrayContaining(["/hosts/index.json", "/hosts/shared-quotes.json", "/hosts/ace.json", "/hosts/fox.json", "/hosts/chip.json"]));
  });

  it("uses whatever the manifest says is the default", async () => {
    global.fetch = serveHosts({ ...hostFiles, "/hosts/index.json": { ...hostFiles["/hosts/index.json"], default: "chip" } });
    render(<WheelSpinner categories={cats} onSpinComplete={jest.fn()} onSpinFinished={jest.fn()} />);
    await flush();
    expect(screen.getByRole("combobox", { name: /host/i })).toHaveValue("chip");
  });

  it("remembers the chosen host across mounts", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { unmount } = render(<WheelSpinner categories={cats} onSpinComplete={jest.fn()} onSpinFinished={jest.fn()} />);
    await flush();
    await user.selectOptions(screen.getByRole("combobox", { name: /host/i }), "fox");
    expect(window.localStorage.getItem("wheelHost")).toBe("fox");
    unmount();

    render(<WheelSpinner categories={cats} onSpinComplete={jest.fn()} onSpinFinished={jest.fn()} />);
    await flush();
    expect(screen.getByRole("combobox", { name: /host/i })).toHaveValue("fox");
  });

  it("falls back to the default host when the saved one no longer exists", async () => {
    window.localStorage.setItem("wheelHost", "retired-host");
    render(<WheelSpinner categories={cats} onSpinComplete={jest.fn()} onSpinFinished={jest.fn()} />);
    await flush();
    expect(screen.getByRole("combobox", { name: /host/i })).toHaveValue("ace");
  });

  it("skips a broken host file, warns, and keeps the rest", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = serveHosts({ ...hostFiles, "/hosts/fox.json": { name: "Fox", look: { head: "dragon", outfit: "suit" } } });
    render(<WheelSpinner categories={cats} onSpinComplete={jest.fn()} onSpinFinished={jest.fn()} />);
    await flush();
    const select = screen.getByRole("combobox", { name: /host/i });
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["ace", "chip"]);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/fox\.json/);
  });

  it("still works, without a dropdown, when no host files can be loaded", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = serveHosts({});
    const onSpinComplete = jest.fn(async () => ({ winners: [cats[0]], newCategories: cats }));
    const onSpinFinished = jest.fn();
    render(<WheelSpinner categories={cats} onSpinComplete={onSpinComplete} onSpinFinished={onSpinFinished} />);
    await flush();
    expect(screen.queryByRole("combobox")).toBeNull();
    tick(50);
    await act(async () => screen.getByRole("button", { name: /spin it/i }).click());
    tick(14000);
    expect(onSpinFinished).toHaveBeenCalledTimes(1);
  });

  it("locks the host dropdown while a spin is running", async () => {
    const onSpinComplete = jest.fn(async () => ({ winners: [cats[0]], newCategories: cats }));
    render(<WheelSpinner categories={cats} onSpinComplete={onSpinComplete} onSpinFinished={jest.fn()} />);
    await flush();
    tick(50);
    await act(async () => screen.getByRole("button", { name: /spin it/i }).click());
    expect(screen.getByRole("combobox", { name: /host/i })).toBeDisabled();
  });

  describe("when the local wheel is stale (review feedback)", () => {
    const ghost = { id: "zzz", name: "Ghost", weight: 1, selectedCount: 0 };

    it("animates to the winner using the server's categories instead of claiming a failure", async () => {
      global.fetch = serveHosts(quoteHostFiles);
      const local = [cats[0], cats[2]];
      const onSpinComplete = jest.fn(async () => ({ winners: [cats[1]], newCategories: cats }));
      const onSpinFinished = jest.fn();
      render(<WheelSpinner categories={local} onSpinComplete={onSpinComplete} onSpinFinished={onSpinFinished} />);
      await flush();
      tick(50);
      await act(async () => screen.getByRole("button", { name: /spin it/i }).click());

      const seen = new Set();
      tickUntil(() => false, 3000, seen);
      expect(onSpinFinished).not.toHaveBeenCalled();
      tickUntil(() => onSpinFinished.mock.calls.length > 0, 14000, seen);
      expect(onSpinFinished).toHaveBeenCalledTimes(1);
      expect(onSpinFinished.mock.calls[0][0].winners[0].id).toBe("b");
      expect(Array.from(seen).join("|")).not.toMatch(/ERROR_LINE/);
    });

    it("shows the result without an error line when the winner is in no known slice", async () => {
      global.fetch = serveHosts(quoteHostFiles);
      const onSpinComplete = jest.fn(async () => ({ winners: [ghost], newCategories: cats }));
      const onSpinFinished = jest.fn();
      render(<WheelSpinner categories={cats} onSpinComplete={onSpinComplete} onSpinFinished={onSpinFinished} />);
      await flush();
      tick(50);
      await act(async () => screen.getByRole("button", { name: /spin it/i }).click());

      const seen = new Set();
      tickUntil(() => onSpinFinished.mock.calls.length > 0, 14000, seen);
      expect(onSpinFinished).toHaveBeenCalledTimes(1);
      expect(onSpinFinished.mock.calls[0][0].winners[0].name).toBe("Ghost");
      tickUntil(() => false, 400, seen);
      const lines = Array.from(seen).join("|");
      expect(lines).toMatch(/RESULT_LINE Ghost/);
      expect(lines).not.toMatch(/ERROR_LINE/);
    });

    it("still reports a real request failure as an error", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      global.fetch = serveHosts(quoteHostFiles);
      const onSpinComplete = jest.fn(async () => {
        throw new Error("nope");
      });
      render(<WheelSpinner categories={cats} onSpinComplete={onSpinComplete} onSpinFinished={jest.fn()} />);
      await flush();
      tick(50);
      await act(async () => screen.getByRole("button", { name: /spin it/i }).click());
      const seen = new Set();
      tickUntil(() => false, 3000, seen);
      expect(Array.from(seen).join("|")).toMatch(/ERROR_LINE/);
    });
  });

  describe("repeat spins (review feedback)", () => {
    it("re-enables SPIN IT and the host dropdown the moment the wheel stops, not after the walk-out", async () => {
      const onSpinComplete = jest.fn(async () => ({ winners: [cats[0]], newCategories: cats }));
      const onSpinFinished = jest.fn();
      render(<WheelSpinner categories={cats} onSpinComplete={onSpinComplete} onSpinFinished={onSpinFinished} />);
      await flush();
      tick(50);
      await act(async () => screen.getByRole("button", { name: /spin it/i }).click());
      expect(screen.getByRole("button")).toBeDisabled();

      tickUntil(() => onSpinFinished.mock.calls.length > 0, 14000);
      expect(onSpinFinished).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: /spin it/i })).toBeEnabled();
      expect(screen.getByRole("combobox", { name: /host/i })).toBeEnabled();
    });

    it("lets a new spin cut the previous walk-out short", async () => {
      const onSpinComplete = jest.fn(async () => ({ winners: [cats[2]], newCategories: cats }));
      const onSpinFinished = jest.fn();
      render(<WheelSpinner categories={cats} onSpinComplete={onSpinComplete} onSpinFinished={onSpinFinished} />);
      await flush();
      tick(50);
      await act(async () => screen.getByRole("button", { name: /spin it/i }).click());
      tickUntil(() => onSpinFinished.mock.calls.length > 0, 14000);
      tick(200);

      await act(async () => screen.getByRole("button", { name: /spin it/i }).click());
      expect(onSpinComplete).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button")).toBeDisabled();
      tickUntil(() => onSpinFinished.mock.calls.length > 1, 14000);
      expect(onSpinFinished).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: /spin it/i })).toBeEnabled();
    });

    it("ignores a second click while a spin is still locked", async () => {
      const onSpinComplete = jest.fn(async () => ({ winners: [cats[0]], newCategories: cats }));
      render(<WheelSpinner categories={cats} onSpinComplete={onSpinComplete} onSpinFinished={jest.fn()} />);
      await flush();
      tick(50);
      const button = screen.getByRole("button", { name: /spin it/i });
      await act(async () => button.click());
      tick(1000);
      await act(async () => button.click());
      expect(onSpinComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe("reduced motion (review feedback)", () => {
    it("skips the walk and the rotation and finishes in about a second", async () => {
      window.matchMedia = jest.fn(() => ({ matches: true }));
      const onSpinComplete = jest.fn(async () => ({ winners: [cats[0]], newCategories: cats }));
      const onSpinFinished = jest.fn();
      render(<WheelSpinner categories={cats} onSpinComplete={onSpinComplete} onSpinFinished={onSpinFinished} />);
      await flush();
      tick(50);
      await act(async () => screen.getByRole("button", { name: /spin it/i }).click());
      tickUntil(() => onSpinFinished.mock.calls.length > 0, 2500);
      expect(onSpinFinished).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: /spin it/i })).toBeEnabled();
    });

    it("follows a change of the setting made while the page is open", async () => {
      let listener;
      window.matchMedia = jest.fn(() => ({
        matches: false,
        addEventListener: (_, fn) => {
          listener = fn;
        },
        removeEventListener: jest.fn(),
      }));
      const onSpinFinished = jest.fn();
      const onSpinComplete = jest.fn(async () => ({ winners: [cats[0]], newCategories: cats }));
      render(<WheelSpinner categories={cats} onSpinComplete={onSpinComplete} onSpinFinished={onSpinFinished} />);
      await flush();
      act(() => listener({ matches: true }));
      tick(50);
      await act(async () => screen.getByRole("button", { name: /spin it/i }).click());
      tickUntil(() => onSpinFinished.mock.calls.length > 0, 2500);
      expect(onSpinFinished).toHaveBeenCalledTimes(1);
    });
  });

  describe("idle and offscreen power use (review feedback)", () => {
    it("stops its frame loop after a long idle and wakes on pointer movement", async () => {
      const { container } = render(<WheelSpinner categories={cats} onSpinComplete={jest.fn()} onSpinFinished={jest.fn()} />);
      await flush();
      tick(60000, 100);
      expect(rafCbs).toHaveLength(0);

      fireEvent.pointerMove(container.firstChild);
      expect(rafCbs.length).toBeGreaterThan(0);
    });

    it("keeps running during a spin however long the page has been idle", async () => {
      const onSpinComplete = jest.fn(async () => ({ winners: [cats[0]], newCategories: cats }));
      const onSpinFinished = jest.fn();
      const { container } = render(<WheelSpinner categories={cats} onSpinComplete={onSpinComplete} onSpinFinished={onSpinFinished} />);
      await flush();
      tick(60000, 100);
      expect(rafCbs).toHaveLength(0);
      fireEvent.pointerMove(container.firstChild);
      await act(async () => screen.getByRole("button", { name: /spin it/i }).click());
      tickUntil(() => onSpinFinished.mock.calls.length > 0, 14000);
      expect(onSpinFinished).toHaveBeenCalledTimes(1);
    });

    it("pauses while scrolled out of view and resumes when visible again", async () => {
      let observe;
      const disconnect = jest.fn();
      global.IntersectionObserver = class {
        constructor(cb) {
          observe = cb;
        }
        observe() {}
        disconnect() {
          disconnect();
        }
      };
      const { unmount } = render(<WheelSpinner categories={cats} onSpinComplete={jest.fn()} onSpinFinished={jest.fn()} />);
      await flush();
      tick(50);
      act(() => observe([{ isIntersecting: false }]));
      tick(3000);
      expect(rafCbs).toHaveLength(0);

      act(() => observe([{ isIntersecting: true }]));
      expect(rafCbs.length).toBeGreaterThan(0);
      unmount();
      expect(disconnect).toHaveBeenCalled();
      delete global.IntersectionObserver;
    });
  });
});
