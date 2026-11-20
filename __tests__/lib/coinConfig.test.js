import {
  normalizeConfig,
  validateText,
  validateEmoji,
  isValidColor,
  isValidConfigId,
  isPresetId,
  PRESETS,
  ConfigError,
} from "@/lib/coinConfig";

describe("lib/coinConfig", () => {
  describe("color validation", () => {
    it("accepts valid 6-char hex colors", () => {
      expect(isValidColor("#ffffff")).toBe(true);
      expect(isValidColor("#000000")).toBe(true);
      expect(isValidColor("#3b82f6")).toBe(true);
      expect(isValidColor("#EC4899")).toBe(true);
    });

    it("rejects invalid colors", () => {
      expect(isValidColor("red")).toBe(false);
      expect(isValidColor("#fff")).toBe(false);
      expect(isValidColor("#1234567")).toBe(false);
      expect(isValidColor("url(evil.com)")).toBe(false);
      expect(isValidColor("#ffffff; background: url(x)")).toBe(false);
    });
  });

  describe("text face validation", () => {
    it("accepts valid short text", () => {
      expect(validateText("H")).toBe(true);
      expect(validateText("Tails")).toBe(true);
      expect(validateText("123456789012")).toBe(true); // 12 chars
    });

    it("rejects text longer than 12 characters", () => {
      expect(validateText("1234567890123")).toBe(false);
    });

    it("rejects empty text or whitespace", () => {
      expect(validateText("")).toBe(false);
      expect(validateText("   ")).toBe(false);
      expect(validateText(null)).toBe(false);
    });

    it("rejects text with HTML or dangerous control characters", () => {
      expect(validateText("<script>")).toBe(false);
      expect(validateText("Hello\u0000World")).toBe(false);
      expect(validateText("\u202eRTL_OVERRIDE")).toBe(false);
    });
  });

  describe("emoji face validation", () => {
    it("accepts single standard pictograph emojis", () => {
      expect(validateEmoji("👑")).toBe(true);
      expect(validateEmoji("🔥")).toBe(true);
      expect(validateEmoji("⚡")).toBe(true);
      expect(validateEmoji("🪙")).toBe(true);
    });

    it("accepts compound emojis (skin-tone, ZWJ sequences)", () => {
      expect(validateEmoji("👍🏽")).toBe(true); // thumbs up + skin tone
      expect(validateEmoji("👨‍👩‍👧‍👦")).toBe(true); // family ZWJ sequence
      expect(validateEmoji("🏳️‍🌈")).toBe(true); // rainbow flag
    });

    it("rejects multi-character text or multiple emojis", () => {
      expect(validateEmoji("Hello")).toBe(false);
      expect(validateEmoji("A")).toBe(false);
      expect(validateEmoji("👑⚓")).toBe(false);
      expect(validateEmoji("")).toBe(false);
      expect(validateEmoji(null)).toBe(false);
    });
  });

  describe("presets and IDs", () => {
    it("provides 4 built-in presets", () => {
      expect(PRESETS.length).toBe(4);
      expect(PRESETS.map((p) => p.name)).toEqual([
        "US Quarter",
        "Euro",
        "Gold Doubloon",
        "Neon",
      ]);
    });

    it("recognizes preset IDs", () => {
      expect(isPresetId("preset:quarter")).toBe(true);
      expect(isPresetId("preset:unknown")).toBe(false);
    });

    it("validates UUIDs for custom configs", () => {
      expect(isValidConfigId("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
      expect(isValidConfigId("not-a-uuid")).toBe(false);
      expect(isValidConfigId("")).toBe(false);
    });
  });

  describe("normalizeConfig", () => {
    const validCustom = {
      name: "Lucky Coin",
      style: "modern",
      headsColor: "#3b82f6",
      tailsColor: "#ec4899",
      rimColor: "#ffffff",
      heads: { type: "emoji", value: "🍀" },
      tails: { type: "text", value: "FAIL" },
    };

    it("normalizes and assigns a UUID when ID is not provided", async () => {
      const normalized = await normalizeConfig(validCustom);
      expect(isValidConfigId(normalized.id)).toBe(true);
      expect(normalized.name).toBe("Lucky Coin");
      expect(normalized.style).toBe("modern");
      expect(normalized.heads).toEqual({ type: "emoji", value: "🍀" });
      expect(normalized.tails).toEqual({ type: "text", value: "FAIL" });
    });

    it("rejects prototype pollution or unknown properties", async () => {
      const malicious = {
        ...validCustom,
        __proto__: { evil: true },
        extraField: "bad",
      };
      // Extra properties are not copied to normalized result
      const normalized = await normalizeConfig(malicious);
      expect(normalized.extraField).toBeUndefined();
    });

    it("throws ConfigError on invalid name", async () => {
      await expect(
        normalizeConfig({ ...validCustom, name: "" })
      ).rejects.toThrow(ConfigError);
      await expect(
        normalizeConfig({ ...validCustom, name: "A".repeat(35) })
      ).rejects.toThrow(ConfigError);
      await expect(
        normalizeConfig({ ...validCustom, name: "<b>Hack</b>" })
      ).rejects.toThrow(ConfigError);
    });

    it("throws ConfigError on invalid color", async () => {
      await expect(
        normalizeConfig({ ...validCustom, headsColor: "not-color" })
      ).rejects.toThrow(ConfigError);
    });

    it("throws ConfigError on invalid style", async () => {
      await expect(
        normalizeConfig({ ...validCustom, style: "cyberpunk" })
      ).rejects.toThrow(ConfigError);
    });
  });
});
