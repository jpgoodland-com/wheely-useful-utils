import fs from "fs";
import path from "path";
import { POST as postToss } from "@/app/api/coin-flip/toss/route";
import { PUT as putConfig } from "@/app/api/coin-flip/config/route";
import { DELETE as deleteUserAccount } from "@/app/api/auth/delete-account/route";
import { DELETE as adminDeleteUser } from "@/app/api/admin/users/[userId]/route";
import { proxy } from "@/proxy";
import nextConfig from "@/next.config.mjs";
import packageJson from "@/package.json";

jest.mock("@/lib/dynamodb", () => ({
  docClient: { send: jest.fn() },
  TableNames: {
    Users: "WheelApp_Users",
    Wheels: "WheelApp_Wheels",
    CoinFlip: "WheelApp_CoinFlip",
  },
}));

jest.mock("@/lib/session", () => ({
  getSession: jest.fn(),
}));

jest.mock("@/lib/email", () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/rateLimit", () => ({
  checkRateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 10, resetMs: Date.now() + 60000 }),
}));

const { docClient } = require("@/lib/dynamodb");
const { getSession } = require("@/lib/session");
const { checkRateLimit } = require("@/lib/rateLimit");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Coin Flip Security Hardening", () => {
  const rootDir = path.join(__dirname, "..", "..");
  const read = (relPath) => fs.readFileSync(path.join(rootDir, relPath), "utf8");

  describe("CSPRNG and Randomness Verification", () => {
    it("uses crypto.randomBytes and never Math.random in coinFlip / secureRandom", () => {
      const secureRandomCode = read("lib/secureRandom.js");
      const coinFlipCode = read("lib/coinFlip.js");
      expect(secureRandomCode).toMatch(/crypto\.randomBytes/);
      expect(secureRandomCode).not.toMatch(/Math\.random/);
      expect(coinFlipCode).not.toMatch(/Math\.random/);
    });

    it("client-supplied history is strictly ignored on /api/coin-flip/toss", async () => {
      getSession.mockResolvedValue({ userId: "victim", username: "victim" });

      let keyQueried = null;
      docClient.send.mockImplementation(async (cmd) => {
        if (cmd.input?.Key?.PK) keyQueried = cmd.input.Key.PK;
        if (cmd.input?.Key?.PK === "COINFLIP#HISTORY#victim") {
          return { Item: { results: "H", heads: 1, tails: 0, updatedAt: 10 } };
        }
        return {};
      });

      // Attacker sends arbitrary history trying to force repeat probability nudge
      const maliciousHistory = ["heads", "tails", "heads", "tails", "heads", "tails"];
      const req = new Request("http://localhost/api/coin-flip/toss", {
        method: "POST",
        body: JSON.stringify({ count: 1, history: maliciousHistory }),
      });

      const res = await postToss(req);
      expect(res.status).toBe(200);
      // Server queried the victim's server-stored history, NOT using the client payload
      expect(keyQueried).toBe("COINFLIP#HISTORY#victim");
    });
  });

  describe("Payload Limits and Injection Prevention", () => {
    it("rejects oversized request payloads with 413 Payload Too Large", async () => {
      getSession.mockResolvedValue({ userId: "u1" });
      const hugeData = "A".repeat(250 * 1024); // Exceeds 200 KB max
      const req = new Request("http://localhost/api/coin-flip/config", {
        method: "PUT",
        body: hugeData,
      });
      const res = await putConfig(req);
      expect(res.status).toBe(413);
    });

    it("rejects XSS and CSS injection payloads in coin configs", async () => {
      getSession.mockResolvedValue({ userId: "u1" });
      docClient.send.mockResolvedValue({ Item: { configs: [] } });

      const xssPayloads = [
        { name: "<script>alert(1)</script>" },
        { headsColor: "red; background:url('https://attacker.com')" },
        { heads: { type: "text", value: "<img src=x onerror=alert(1)>" } },
        { heads: { type: "emoji", value: "javascript:alert(1)" } },
        { heads: { type: "image", value: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" } },
      ];

      for (const payload of xssPayloads) {
        const body = {
          name: "Good Name",
          style: "classic",
          headsColor: "#ffffff",
          tailsColor: "#000000",
          rimColor: "#cccccc",
          heads: { type: "text", value: "H" },
          tails: { type: "text", value: "T" },
          ...payload,
        };
        const req = new Request("http://localhost/api/coin-flip/config", {
          method: "PUT",
          body: JSON.stringify(body),
        });
        const res = await putConfig(req);
        expect(res.status).toBe(400);
      }
    });

    it("verifies sharp is pinned to an exact version in package.json", () => {
      const sharpDep = packageJson.dependencies.sharp;
      expect(sharpDep).toBeDefined();
      // Ensure no range operators like ^, ~, or >=
      expect(sharpDep).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
    });
  });

  describe("Proxy Rate Limiting Tiers", () => {
    it("maps /api/coin-flip/toss to coin-toss rate limit tier", () => {
      const req = {
        nextUrl: { pathname: "/api/coin-flip/toss", protocol: "https:" },
        headers: new Headers({ "x-forwarded-for": "10.0.0.1" }),
      };
      proxy(req);
      expect(checkRateLimit).toHaveBeenCalledWith(
        "coin-toss:10.0.0.1",
        60,
        60000
      );
    });

    it("maps /api/coin-flip/config to coin-config rate limit tier", () => {
      const req = {
        nextUrl: { pathname: "/api/coin-flip/config", protocol: "https:" },
        headers: new Headers({ "x-forwarded-for": "10.0.0.1" }),
      };
      proxy(req);
      expect(checkRateLimit).toHaveBeenCalledWith(
        "coin-config:10.0.0.1",
        20,
        60000
      );
    });
  });

  describe("Account Deletion Cleanup", () => {
    it("deletes user's coin-flip config and history on user self-delete", async () => {
      getSession.mockResolvedValue({ userId: "u-to-delete", username: "target", email: "target@test.com" });
      docClient.send.mockResolvedValue({ Items: [] });

      const res = await deleteUserAccount(new Request("http://localhost/api/auth/delete-account", { method: "DELETE" }));
      expect(res.status).toBe(200);

      // Verify deletion calls for COINFLIP#CONFIG and COINFLIP#HISTORY
      const deleteCalls = docClient.send.mock.calls
        .map(([cmd]) => cmd.input)
        .filter((input) => input?.TableName === "WheelApp_CoinFlip");

      expect(deleteCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ Key: { PK: "COINFLIP#CONFIG#u-to-delete" } }),
          expect.objectContaining({ Key: { PK: "COINFLIP#HISTORY#u-to-delete" } }),
        ])
      );
    });

    it("deletes user's coin-flip config and history on admin user delete", async () => {
      getSession.mockResolvedValue({ userId: "admin1", username: "admin", isAdmin: true });
      docClient.send.mockImplementation(async (cmd) => {
        if (cmd.input?.Key?.PK === "USER#victim-user") {
          return { Item: { userId: "victim-user", username: "victim" } };
        }
        return { Items: [] };
      });

      const res = await adminDeleteUser(
        new Request("http://localhost/api/admin/users/victim-user", { method: "DELETE" }),
        { params: Promise.resolve({ userId: "victim-user" }) }
      );
      expect(res.status).toBe(200);

      const deleteCalls = docClient.send.mock.calls
        .map(([cmd]) => cmd.input)
        .filter((input) => input?.TableName === "WheelApp_CoinFlip");

      expect(deleteCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ Key: { PK: "COINFLIP#CONFIG#victim-user" } }),
          expect.objectContaining({ Key: { PK: "COINFLIP#HISTORY#victim-user" } }),
        ])
      );
    });
  });

  describe("Static Security Checks", () => {
    it("ensures CSP img-src only permits self, data: and blob: (no external hosts)", async () => {
      const headers = await nextConfig.headers();
      const globalHeaderConfig = headers.find((h) => h.source === "/(.*)");
      const csp = globalHeaderConfig.headers.find((h) => h.key === "Content-Security-Policy").value;
      const imgSrcMatch = csp.match(/img-src\s+([^;]+)/);
      expect(imgSrcMatch).not.toBeNull();
      const allowedSources = imgSrcMatch[1].trim().split(/\s+/);
      expect(allowedSources).toEqual(["'self'", "data:", "blob:"]);
    });
  });
});
