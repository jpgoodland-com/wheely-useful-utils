import { GET as getCoinFlip } from "@/app/api/coin-flip/route";
import { POST as postToss } from "@/app/api/coin-flip/toss/route";
import { PUT as putConfig } from "@/app/api/coin-flip/config/route";
import { DELETE as deleteConfigRoute } from "@/app/api/coin-flip/config/[id]/route";
import { PUT as putActive } from "@/app/api/coin-flip/active/route";
import { DELETE as deleteHistoryRoute } from "@/app/api/coin-flip/history/route";

// Storage failures: a lost optimistic-concurrency race maps to 409 so the
// client retries, and anything else is hidden behind a 500 "Internal Error".

jest.mock("@/lib/session", () => ({ getSession: jest.fn() }));
jest.mock("@/lib/coinStore", () => {
  const { ConflictError } = jest.requireActual("@/lib/coinStore");
  return {
    ConflictError,
    getCoinState: jest.fn(),
    saveConfig: jest.fn(),
    deleteConfig: jest.fn(),
    setActive: jest.fn(),
    tossAndStore: jest.fn(),
    clearHistory: jest.fn(),
  };
});

const { getSession } = require("@/lib/session");
const store = require("@/lib/coinStore");

const CONFIG_ID = "123e4567-e89b-12d3-a456-426614174000";
const SECRET = "ProvisionedThroughputExceeded on WheelApp_CoinFlip arn:aws:dynamodb:us-west-2:000000000000";

const json = (method, body) =>
  new Request("http://localhost/api/coin-flip", { method, body: JSON.stringify(body) });

const routes = {
  "GET /api/coin-flip": { call: () => getCoinFlip(), store: "getCoinState" },
  "POST /api/coin-flip/toss": { call: () => postToss(json("POST", { count: 1 })), store: "tossAndStore", conflict: true },
  "PUT /api/coin-flip/config": {
    call: () =>
      putConfig(
        json("PUT", {
          name: "My Coin",
          style: "classic",
          headsColor: "#112233",
          tailsColor: "#445566",
          rimColor: "#778899",
          heads: { type: "text", value: "YES" },
          tails: { type: "text", value: "NO" },
        })
      ),
    store: "saveConfig",
    conflict: true,
  },
  "DELETE /api/coin-flip/config/[id]": {
    call: () => deleteConfigRoute(json("DELETE"), { params: Promise.resolve({ id: CONFIG_ID }) }),
    store: "deleteConfig",
    conflict: true,
  },
  "PUT /api/coin-flip/active": { call: () => putActive(json("PUT", { id: CONFIG_ID })), store: "setActive", conflict: true },
  "DELETE /api/coin-flip/history": { call: () => deleteHistoryRoute(), store: "clearHistory" },
};

let consoleError;

beforeEach(() => {
  jest.clearAllMocks();
  getSession.mockResolvedValue({ userId: "user-123", username: "tester" });
  store.getCoinState.mockResolvedValue({ configs: [], activeId: null, results: [], totals: { heads: 0, tails: 0 } });
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe.each(Object.entries(routes))("%s storage errors", (name, route) => {
  it("hides an unexpected failure behind a 500 Internal Error", async () => {
    store[route.store].mockRejectedValue(new Error(SECRET));

    const res = await route.call();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Internal Error" });
    expect(JSON.stringify(body)).not.toContain("WheelApp");
    // Logged server-side for CloudWatch, never returned.
    expect(consoleError).toHaveBeenCalled();
  });

  if (route.conflict) {
    it("asks the client to retry after a write conflict (409)", async () => {
      store[route.store].mockRejectedValue(new store.ConflictError("version changed"));

      const res = await route.call();

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Please retry" });
      expect(consoleError).not.toHaveBeenCalled();
    });
  }
});
