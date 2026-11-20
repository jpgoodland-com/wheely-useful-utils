import { GET as getCoinFlip } from "@/app/api/coin-flip/route";
import { POST as postToss } from "@/app/api/coin-flip/toss/route";
import { PUT as putConfig } from "@/app/api/coin-flip/config/route";
import { DELETE as deleteConfigRoute } from "@/app/api/coin-flip/config/[id]/route";
import { PUT as putActive } from "@/app/api/coin-flip/active/route";
import { DELETE as deleteHistoryRoute } from "@/app/api/coin-flip/history/route";

jest.mock("@/lib/dynamodb", () => ({
  docClient: { send: jest.fn() },
  TableNames: { CoinFlip: "WheelApp_CoinFlip" },
}));

jest.mock("@/lib/session", () => ({
  getSession: jest.fn(),
}));

const { docClient } = require("@/lib/dynamodb");
const { getSession } = require("@/lib/session");

const mockUser = { userId: "user-123", username: "tester" };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Coin Flip API Routes", () => {
  describe("GET /api/coin-flip", () => {
    it("returns 401 when unauthenticated", async () => {
      getSession.mockResolvedValue(null);
      const res = await getCoinFlip();
      expect(res.status).toBe(401);
    });

    it("returns presets, configs, history, and activeId when authenticated", async () => {
      getSession.mockResolvedValue(mockUser);
      docClient.send.mockImplementation(async (cmd) => {
        if (cmd.input?.Key?.PK === "COINFLIP#CONFIG#user-123") {
          return { Item: { configs: [], activeId: "preset:quarter" } };
        }
        if (cmd.input?.Key?.PK === "COINFLIP#HISTORY#user-123") {
          return { Item: { results: "HTH", heads: 2, tails: 1 } };
        }
        return { Item: null };
      });

      const res = await getCoinFlip();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.presets.length).toBeGreaterThan(0);
      expect(data.activeId).toBe("preset:quarter");
      expect(data.results).toEqual(["heads", "tails", "heads"]);
      expect(data.totals).toEqual({ heads: 2, tails: 1 });
    });
  });

  describe("POST /api/coin-flip/toss", () => {
    it("returns 401 when unauthenticated", async () => {
      getSession.mockResolvedValue(null);
      const req = new Request("http://localhost/api/coin-flip/toss", {
        method: "POST",
        body: JSON.stringify({ count: 1 }),
      });
      const res = await postToss(req);
      expect(res.status).toBe(401);
    });

    it("rejects non-integer or out-of-range count", async () => {
      getSession.mockResolvedValue(mockUser);
      const req = new Request("http://localhost/api/coin-flip/toss", {
        method: "POST",
        body: JSON.stringify({ count: 500 }),
      });
      const res = await postToss(req);
      expect(res.status).toBe(400);
    });

    it("performs flip and stores updated history", async () => {
      getSession.mockResolvedValue(mockUser);
      docClient.send.mockImplementation(async (cmd) => {
        if (cmd.input?.Key?.PK === "COINFLIP#HISTORY#user-123") {
          return { Item: { results: "H", heads: 1, tails: 0, updatedAt: 100 } };
        }
        return {}; // PutCommand success
      });

      const req = new Request("http://localhost/api/coin-flip/toss", {
        method: "POST",
        body: JSON.stringify({ count: 2 }),
      });
      const res = await postToss(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results.length).toBe(2);
      expect(data.totals.heads + data.totals.tails).toBe(3); // 1 prior + 2 new
    });
  });

  describe("PUT /api/coin-flip/config", () => {
    const validPayload = {
      name: "My Coin",
      style: "classic",
      headsColor: "#112233",
      tailsColor: "#445566",
      rimColor: "#778899",
      heads: { type: "text", value: "YES" },
      tails: { type: "text", value: "NO" },
    };

    it("returns 401 when unauthenticated", async () => {
      getSession.mockResolvedValue(null);
      const req = new Request("http://localhost/api/coin-flip/config", {
        method: "PUT",
        body: JSON.stringify(validPayload),
      });
      const res = await putConfig(req);
      expect(res.status).toBe(401);
    });

    it("rejects invalid config payload", async () => {
      getSession.mockResolvedValue(mockUser);
      docClient.send.mockResolvedValue({ Item: { configs: [] } });

      const req = new Request("http://localhost/api/coin-flip/config", {
        method: "PUT",
        body: JSON.stringify({ ...validPayload, headsColor: "not-color" }),
      });
      const res = await putConfig(req);
      expect(res.status).toBe(400);
    });

    it("enforces max 5 custom configs limit", async () => {
      getSession.mockResolvedValue(mockUser);
      const existingConfigs = [1, 2, 3, 4, 5].map((i) => ({
        id: `00000000-0000-4000-8000-00000000000${i}`,
        name: `Coin ${i}`,
      }));
      docClient.send.mockImplementation(async (cmd) => {
        if (cmd.input?.Key?.PK === "COINFLIP#CONFIG#user-123") {
          return { Item: { configs: existingConfigs } };
        }
        return {};
      });

      const req = new Request("http://localhost/api/coin-flip/config", {
        method: "PUT",
        body: JSON.stringify(validPayload),
      });
      const res = await putConfig(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("up to 5");
    });

    it("saves new valid configuration successfully", async () => {
      getSession.mockResolvedValue(mockUser);
      docClient.send.mockImplementation(async (cmd) => {
        if (cmd.input?.Key?.PK === "COINFLIP#CONFIG#user-123") {
          return { Item: { configs: [] } };
        }
        return {};
      });

      const req = new Request("http://localhost/api/coin-flip/config", {
        method: "PUT",
        body: JSON.stringify(validPayload),
      });
      const res = await putConfig(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.config.name).toBe("My Coin");
      expect(data.configs.length).toBe(1);
    });
  });

  describe("DELETE /api/coin-flip/config/[id]", () => {
    it("returns 404 if config ID does not exist", async () => {
      getSession.mockResolvedValue(mockUser);
      docClient.send.mockResolvedValue({ Item: { configs: [] } });

      const req = new Request("http://localhost/api/coin-flip/config/123e4567-e89b-12d3-a456-426614174000");
      const res = await deleteConfigRoute(req, {
        params: Promise.resolve({ id: "123e4567-e89b-12d3-a456-426614174000" }),
      });
      expect(res.status).toBe(404);
    });

    it("deletes config and returns 200", async () => {
      getSession.mockResolvedValue(mockUser);
      const id = "123e4567-e89b-12d3-a456-426614174000";
      docClient.send.mockImplementation(async (cmd) => {
        if (cmd.input?.Key?.PK === "COINFLIP#CONFIG#user-123") {
          return { Item: { configs: [{ id, name: "Coin" }], activeId: id } };
        }
        return {};
      });

      const req = new Request(`http://localhost/api/coin-flip/config/${id}`);
      const res = await deleteConfigRoute(req, {
        params: Promise.resolve({ id }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe("PUT /api/coin-flip/active", () => {
    it("sets active preset ID", async () => {
      getSession.mockResolvedValue(mockUser);
      docClient.send.mockResolvedValue({ Item: { configs: [] } });

      const req = new Request("http://localhost/api/coin-flip/active", {
        method: "PUT",
        body: JSON.stringify({ id: "preset:euro" }),
      });
      const res = await putActive(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.activeId).toBe("preset:euro");
    });
  });

  describe("DELETE /api/coin-flip/history", () => {
    it("clears history item in DynamoDB", async () => {
      getSession.mockResolvedValue(mockUser);
      docClient.send.mockResolvedValue({});

      const res = await deleteHistoryRoute();
      expect(res.status).toBe(200);
      expect(docClient.send).toHaveBeenCalled();
    });
  });
});
