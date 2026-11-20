import {
  isMockEnabled,
  getAuthUrl,
  exchangeCode,
  fetchUserProfile,
} from "@/lib/oauth";

describe("lib/oauth mock mode", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      OAUTH_MOCK: "true",
      OAUTH_GOOGLE_CLIENT_ID: "mock-google-id",
      OAUTH_GOOGLE_CLIENT_SECRET: "mock-google-secret",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("isMockEnabled returns true when OAUTH_MOCK is true", () => {
    expect(isMockEnabled("google")).toBe(true);
  });

  it("isMockEnabled returns true when NODE_ENV is development and client ID starts with mock-", () => {
    delete process.env.OAUTH_MOCK;
    expect(isMockEnabled("google")).toBe(true);
  });

  it("isMockEnabled returns true when NODE_ENV is development and client ID is empty", () => {
    delete process.env.OAUTH_MOCK;
    process.env.OAUTH_GOOGLE_CLIENT_ID = "";
    expect(isMockEnabled("google")).toBe(true);
  });

  it("isMockEnabled returns false in production even with mock IDs", () => {
    delete process.env.OAUTH_MOCK;
    process.env.NODE_ENV = "production";
    expect(isMockEnabled("google")).toBe(false);
  });

  it("isMockEnabled ignores OAUTH_MOCK=true in production", () => {
    process.env.NODE_ENV = "production";
    expect(isMockEnabled("google")).toBe(false);
  });

  it("a mock code is not accepted in production", async () => {
    process.env.NODE_ENV = "production";
    global.fetch = jest.fn().mockResolvedValue(new Response("", { status: 400 }));
    await expect(exchangeCode("google", "mock-code-google-ZXZpbEBleGFtcGxlLmNvbQ", "http://x", "v")).rejects.toThrow(/token exchange failed/i);
  });

  it("getAuthUrl redirects to local sandbox url when mock is enabled", () => {
    const url = getAuthUrl("google", { state: "teststate" }, "http://localhost:3000/api/auth/callback/google");
    expect(url).toBe("http://localhost:3000/auth/mock?provider=google&state=teststate&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fcallback%2Fgoogle");
  });

  it("exchangeCode returns an access token encoding the email", async () => {
    const code = "mock-code-google-ZGV2ZWxvcGVyQGV4YW1wbGUuY29t"; // base64 for developer@example.com
    const tokens = await exchangeCode("google", code, "http://localhost:3000/callback");
    expect(tokens).toEqual({ access_token: "mock-token-google-ZGV2ZWxvcGVyQGV4YW1wbGUuY29t" });
  });

  it("fetchUserProfile decodes a verified email and name from the mock access token", async () => {
    const profile = await fetchUserProfile("google", { access_token: "mock-token-google-ZGV2ZWxvcGVyQGV4YW1wbGUuY29t" });
    expect(profile).toMatchObject({ email: "developer@example.com", name: "developer", emailVerified: true });
  });

  it("fetchUserProfile uses fallback for invalid base64 encoding", async () => {
    const profile = await fetchUserProfile("google", { access_token: "mock-token-google-invalid!!!" });
    expect(profile.email).toBe("mock-user@example.com");
    expect(profile.name).toBe("mock-user");
  });
});
