jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return { docClient: createFakeDynamo(), TableNames: { Users: "WheelApp_Users" } };
});

import bcrypt from "bcrypt";
import { docClient } from "@/lib/dynamodb";
import { getClientIp } from "@/lib/clientIp";
import { hashToken, newToken, tokenMatchesHash } from "@/lib/tokens";
import { isAllowlistedAdmin } from "@/lib/users/adminAllowlist";
import { BCRYPT_COST, hashPassword } from "@/lib/users/passwordHash";
import {
  findUserByEmail,
  findUserByIdentifier,
  findUserByUsername,
  isKeyTaken,
  usernameError,
} from "@/lib/users/identity";
import { replacementBase } from "@/scripts/migrate-usernames.mjs";
import { seedUser, USERS_TABLE } from "@/__tests__/helpers/users";

describe("getClientIp", () => {
  const h = (xff) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff });

  it.each([
    ["203.0.113.9", "203.0.113.9"],
    ["1.1.1.1, 203.0.113.9", "203.0.113.9"],
    ["spoof, spoof2 ,  198.51.100.4  ", "198.51.100.4"],
    ["2001:db8::1", "2001:db8::1"],
    ["1.1.1.1, <script>", "script"],
    [",,", "local"],
  ])("%p -> %p", (xff, ip) => {
    expect(getClientIp(h(xff))).toBe(ip);
  });

  it("falls back to local without the header and caps length", () => {
    expect(getClientIp(h())).toBe("local");
    expect(getClientIp(h("x".repeat(200)))).toHaveLength(64);
  });
});

describe("tokens", () => {
  it("issues 256-bit tokens and stores only a SHA-256 hash", () => {
    const { token, hash } = newToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toBe(token);
    expect(newToken().token).not.toBe(token);
  });

  it("matches only the right token", () => {
    const { token, hash } = newToken();
    expect(tokenMatchesHash(token, hash)).toBe(true);
    expect(tokenMatchesHash(token + "0", hash)).toBe(false);
    expect(tokenMatchesHash(hash, hash)).toBe(false); // the stored hash is not a usable token
    for (const bad of [undefined, null, "", 42, {}]) {
      expect(tokenMatchesHash(bad, hash)).toBe(false);
      expect(tokenMatchesHash(token, bad)).toBe(false);
    }
  });
});

describe("isAllowlistedAdmin", () => {
  afterEach(() => delete process.env.ADMIN_EMAILS);

  it("grants nobody when ADMIN_EMAILS is unset, whatever the domain (C3)", () => {
    expect(isAllowlistedAdmin("admin@example.com")).toBe(false);
  });

  it("matches exact addresses case-insensitively", () => {
    process.env.ADMIN_EMAILS = " Boss@Example.com ,,other@example.com";
    expect(isAllowlistedAdmin("boss@example.com")).toBe(true);
    expect(isAllowlistedAdmin("BOSS@EXAMPLE.COM ")).toBe(true);
    expect(isAllowlistedAdmin("boss@example.com.evil.com")).toBe(false);
    expect(isAllowlistedAdmin("xboss@example.com")).toBe(false);
    expect(isAllowlistedAdmin("")).toBe(false);
    expect(isAllowlistedAdmin(undefined)).toBe(false);
  });
});

describe("hashPassword", () => {
  it("uses bcrypt cost 12", async () => {
    expect(BCRYPT_COST).toBe(12);
    const hash = await hashPassword("Some!Password1");
    expect(hash).toMatch(/^\$2b\$12\$/);
    expect(await bcrypt.compare("Some!Password1", hash)).toBe(true);
  });
});

describe("usernameError", () => {
  it.each(["alice", "a.b-c_d", "abc", "x1", "0day"].filter((u) => u.length >= 3))("accepts %p", (u) => {
    expect(usernameError(u)).toBeNull();
  });

  it("normalises case before checking", () => {
    expect(usernameError("Alice")).toBeNull();
  });

  it.each(["ceo@corp.com", "ab", "_lead", ".dot", "has space", "x".repeat(33), "名前", "", null, 7])("rejects %p", (u) => {
    expect(usernameError(u)).toMatch(/username/i);
  });
});

describe("user lookups", () => {
  beforeEach(() => {
    docClient.reset();
    seedUser(docClient, { userId: "u1", username: "alice", email: "alice@example.com" });
    // Legacy squatter: a username equal to someone else's email.
    docClient.put(USERS_TABLE, {
      PK: "USER#USERNAME#bob@corp.com", userId: "evil", username: "bob@corp.com",
      email: "evil@example.com", EmailOrUsername: "bob@corp.com",
    });
    docClient.put(USERS_TABLE, { PK: "INVITE#h", email: "carol@example.com", EmailOrUsername: "invite#carol@example.com" });
  });

  it("finds the primary item by email and the pointer by username", async () => {
    expect((await findUserByEmail("ALICE@example.com")).PK).toBe("USER#u1");
    expect((await findUserByUsername("Alice")).PK).toBe("USER#USERNAME#alice");
    expect((await findUserByIdentifier("alice@example.com")).userId).toBe("u1");
    expect((await findUserByIdentifier("alice")).userId).toBe("u1");
  });

  it("never returns a username pointer for an email lookup (C1)", async () => {
    expect(await findUserByEmail("bob@corp.com")).toBeNull();
    expect(await findUserByIdentifier("bob@corp.com")).toBeNull();
  });

  it("never returns a primary item for a username lookup", async () => {
    expect(await findUserByUsername("alice@example.com")).toBeNull();
  });

  it("isKeyTaken counts legacy items but not invites", async () => {
    expect(await isKeyTaken("bob@corp.com")).toBe(true);
    expect(await isKeyTaken("invite#carol@example.com")).toBe(false);
    expect(await isKeyTaken("nobody@example.com")).toBe(false);
  });

  it("returns null for empty input without querying", async () => {
    docClient.calls = [];
    expect(await findUserByIdentifier("  ")).toBeNull();
    expect(await findUserByEmail(undefined)).toBeNull();
    expect(docClient.calls).toHaveLength(0);
  });
});

describe("migrate-usernames replacementBase", () => {
  it.each([
    ["ceo@corp.com", "ceo"],
    ["A.B@x.com", "a.b"],
    ["@corp.com", "user"],
    ["__x", "userx"],
    ["very-long-local-part-name-here@x.com", "very-long-local-part"],
  ])("%p -> %p", (from, to) => {
    expect(replacementBase(from)).toBe(to);
  });
});
