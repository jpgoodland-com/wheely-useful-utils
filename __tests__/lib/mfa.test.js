import {
  base32Decode,
  base32Encode,
  currentStep,
  generateTotpSecret,
  otpauthUrl,
  totpForStep,
  verifyTotp,
} from "@/lib/mfa/totp";
import { findRecoveryCode, generateRecoveryCodes, normalizeRecoveryCode } from "@/lib/mfa/recoveryCodes";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secretBox";

jest.mock("@aws-sdk/client-kms", () => {
  const send = jest.fn();
  return {
    __send: send,
    KMSClient: jest.fn(() => ({ send })),
    EncryptCommand: jest.fn((input) => ({ kind: "encrypt", input })),
    DecryptCommand: jest.fn((input) => ({ kind: "decrypt", input })),
  };
});

// RFC 6238 Appendix B, SHA-1 secret "12345678901234567890" (last 6 digits).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const RFC_VECTORS = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

describe("TOTP", () => {
  it.each(RFC_VECTORS)("matches RFC 6238 at T=%p", (t, code) => {
    expect(totpForStep(RFC_SECRET, Math.floor(t / 30))).toBe(code);
  });

  it("round-trips base32 and generates 160-bit secrets", () => {
    const buf = Buffer.from([0, 1, 2, 250, 255, 7]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    const secret = generateTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
    expect(() => base32Decode("not!base32")).toThrow();
  });

  it("accepts the current step and one either side, nothing further", () => {
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    for (const offset of [-1, 0, 1]) {
      expect(verifyTotp(RFC_SECRET, totpForStep(RFC_SECRET, step + offset), { nowMs: now })).toBe(step + offset);
    }
    for (const offset of [-2, 2, 10]) {
      expect(verifyTotp(RFC_SECRET, totpForStep(RFC_SECRET, step + offset), { nowMs: now })).toBeNull();
    }
  });

  it("rejects a code whose step was already used (replay)", () => {
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    const code = totpForStep(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now, lastStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpForStep(RFC_SECRET, step - 1), { nowMs: now, lastStep: step - 1 })).toBeNull();
  });

  it.each([undefined, "", "12345", "1234567", "abcdef", "12 34 5"])("rejects malformed code %p", (code) => {
    expect(verifyTotp(RFC_SECRET, code)).toBeNull();
  });

  it("tolerates spaces inside a code", () => {
    const now = Date.now();
    const code = totpForStep(RFC_SECRET, currentStep(now));
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { nowMs: now })).not.toBeNull();
  });

  it("builds an otpauth URL authenticator apps understand", () => {
    const url = new URL(otpauthUrl({ secret: "ABC", account: "a@b.com" }));
    expect(url.protocol).toBe("otpauth:");
    expect(url.searchParams.get("secret")).toBe("ABC");
    expect(url.searchParams.get("period")).toBe("30");
    expect(decodeURIComponent(url.pathname)).toContain("a@b.com");
  });
});

describe("recovery codes", () => {
  it("creates ten distinct codes and stores only hashes", () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    codes.forEach((c) => expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/));
    expect(hashes.join()).not.toContain(normalizeRecoveryCode(codes[0]));
  });

  it("finds a code regardless of case and dashes, and nothing else", () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(findRecoveryCode(hashes, codes[3].toUpperCase().replace("-", " "))).toBe(3);
    expect(findRecoveryCode(hashes, "aaaaa-aaaaa")).toBe(-1);
    expect(findRecoveryCode(hashes, "")).toBe(-1);
    expect(findRecoveryCode(undefined, codes[0])).toBe(-1);
  });
});

describe("secretBox", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    require("@aws-sdk/client-kms").__send.mockReset();
  });

  it("round-trips locally and binds the ciphertext to its context", async () => {
    const blob = await encryptSecret("seed", { userId: "u1", purpose: "totp" });
    expect(blob.startsWith("local:")).toBe(true);
    expect(blob).not.toContain("seed");
    expect(await decryptSecret(blob, { purpose: "totp", userId: "u1" })).toBe("seed");
    await expect(decryptSecret(blob, { userId: "u2", purpose: "totp" })).rejects.toThrow();
  });

  it("produces a different ciphertext each time", async () => {
    const ctx = { userId: "u1", purpose: "totp" };
    expect(await encryptSecret("seed", ctx)).not.toBe(await encryptSecret("seed", ctx));
  });

  it("rejects a ciphertext whose auth tag was truncated or altered", async () => {
    const ctx = { userId: "u1", purpose: "totp" };
    const blob = await encryptSecret("seed", ctx);
    const [iv, tag, ct] = blob.slice(6).split(".");
    const short = Buffer.from(tag, "base64").subarray(0, 4).toString("base64");
    await expect(decryptSecret(`local:${iv}.${short}.${ct}`, ctx)).rejects.toThrow(/malformed/);
    const flipped = Buffer.from(tag, "base64");
    flipped[0] ^= 1;
    await expect(decryptSecret(`local:${iv}.${flipped.toString("base64")}.${ct}`, ctx)).rejects.toThrow();
  });

  it("refuses to work without a context", async () => {
    await expect(encryptSecret("seed", {})).rejects.toThrow(/context/);
  });

  it("requires KMS in production and never trusts a local value there", async () => {
    const local = await encryptSecret("seed", { userId: "u1", purpose: "totp" });
    process.env.NODE_ENV = "production";
    delete process.env.APP_KMS_KEY_ID;
    await expect(encryptSecret("seed", { userId: "u1", purpose: "totp" })).rejects.toThrow(/APP_KMS_KEY_ID/);
    await expect(decryptSecret(local, { userId: "u1", purpose: "totp" })).rejects.toThrow(/non-KMS/);
  });

  it("uses KMS with the encryption context when APP_KMS_KEY_ID is set", async () => {
    process.env.APP_KMS_KEY_ID = "arn:aws:kms:us-west-2:1:key/abc";
    const { __send } = require("@aws-sdk/client-kms");
    __send.mockResolvedValueOnce({ CiphertextBlob: Buffer.from("ct") });
    const blob = await encryptSecret("seed", { userId: "u1", purpose: "totp" });
    expect(blob).toBe(`kms:${Buffer.from("ct").toString("base64")}`);
    expect(__send.mock.calls[0][0].input).toMatchObject({ KeyId: process.env.APP_KMS_KEY_ID, EncryptionContext: { purpose: "totp", userId: "u1" } });

    __send.mockResolvedValueOnce({ Plaintext: Buffer.from("seed") });
    expect(await decryptSecret(blob, { userId: "u1", purpose: "totp" })).toBe("seed");
    expect(__send.mock.calls[1][0].input.EncryptionContext).toEqual({ purpose: "totp", userId: "u1" });
  });
});
