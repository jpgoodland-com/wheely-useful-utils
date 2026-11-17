/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
// A stable user object, as in the real AuthContext; a new one per render would
// re-run the page's [user] effect and reload state after every render.
const mockUser = { userId: "u1", username: "alice" };
jest.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));

// The real flipper animates with the Web Animations API; this stand-in lets a
// test decide whether toss() lands or throws.
const mockToss = jest.fn();
jest.mock("@/components/CoinFlipper", () => {
  const { forwardRef: fwd, useImperativeHandle: useHandle } = jest.requireActual("react");
  return {
    CoinFlipper: fwd(function MockFlipper(props, ref) {
      useHandle(ref, () => ({ toss: (results) => mockToss(results) }));
      return <div data-testid="flipper" />;
    }),
  };
});

import CoinFlipPage from "@/app/features/coin-flip/page";

const COIN = { id: "classic", name: "Classic", heads: { type: "text", value: "H" }, tails: { type: "text", value: "T" } };

function mockApi(tossResponse, history = { results: [], totals: { heads: 0, tails: 0 } }) {
  global.fetch = jest.fn(async (url, opts) => {
    if (url === "/api/coin-flip/toss" && opts?.method === "POST") {
      return { ok: true, json: async () => tossResponse };
    }
    return {
      ok: true,
      json: async () => ({ presets: [COIN], configs: [], activeId: "classic", ...history }),
    };
  });
}

async function renderPage() {
  render(<CoinFlipPage />);
  await screen.findByText("Flip Coin");
}

beforeEach(() => {
  mockToss.mockReset();
  mockApi({ results: ["tails"], totals: { heads: 0, tails: 1 } });
});

describe("Coin flip page", () => {
  it("reports a saved flip even when the animation throws", async () => {
    mockToss.mockRejectedValue(new Error("animate failed"));
    await renderPage();

    fireEvent.click(screen.getByText("Flip Coin"));

    expect(await screen.findByText("Landed on tails!")).toBeInTheDocument();
    expect(screen.getByText("Total Flips: 1")).toBeInTheDocument();
    expect(screen.queryByText("Connection error")).not.toBeInTheDocument();
  });

  it("still reports a connection error when the request itself fails", async () => {
    await renderPage();
    global.fetch.mockRejectedValueOnce(new Error("offline"));

    fireEvent.click(screen.getByText("Flip Coin"));

    expect(await screen.findByText("Connection error")).toBeInTheDocument();
    expect(mockToss).not.toHaveBeenCalled();
  });

  it("disables Clear History while a flip is in the air", async () => {
    mockApi(
      { results: ["tails"], totals: { heads: 1, tails: 1 } },
      { results: ["heads"], totals: { heads: 1, tails: 0 } }
    );
    let land;
    mockToss.mockReturnValue(new Promise((resolve) => (land = resolve)));
    await renderPage();

    const clear = () => screen.getByRole("button", { name: /Clear History/ });
    expect(clear()).toBeEnabled();

    fireEvent.click(screen.getByText("Flip Coin"));
    await waitFor(() => expect(clear()).toBeDisabled());

    land();
    await waitFor(() => expect(clear()).toBeEnabled());
  });

  it("announces results through one live region that stays mounted", async () => {
    let land;
    mockToss.mockReturnValue(new Promise((resolve) => (land = resolve)));
    await renderPage();

    const region = screen.getByText("Click the coin or press Flip below").closest("[aria-live]");
    expect(region).toHaveAttribute("aria-live", "polite");

    fireEvent.click(screen.getByText("Flip Coin"));
    await waitFor(() => expect(region).toHaveTextContent("Flipping..."));

    land();
    await waitFor(() => expect(region).toHaveTextContent("Landed on tails!"));
    expect(region).toBeInTheDocument();
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);
  });
});
