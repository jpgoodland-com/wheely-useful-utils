export const MAX_CUSTOM_CONFIGS = 5;
export const MAX_NAME_LENGTH = 30;
export const MAX_TEXT_LENGTH = 12;
export const STYLES = ["classic", "modern", "retro"];
export const FACE_TYPES = ["text", "emoji", "image"];

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Control chars, bidi overrides/isolates, zero-width (non-joiner handled in emoji only)
export const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff<>]/;

export const PRESET_IMAGE_PATHS = new Set([
  "/coins/quarter-heads.webp",
  "/coins/quarter-tails.webp",
  "/coins/euro-heads.webp",
  "/coins/euro-tails.webp",
  "/coins/doubloon-heads.webp",
  "/coins/doubloon-tails.webp",
]);

export const PRESETS = [
  {
    id: "preset:quarter",
    name: "US Quarter",
    style: "classic",
    heads: { type: "image", value: "/coins/quarter-heads.webp" },
    tails: { type: "image", value: "/coins/quarter-tails.webp" },
    headsColor: "#c0c0c8",
    tailsColor: "#a8a8b4",
    rimColor: "#e5e5ec",
  },
  {
    id: "preset:euro",
    name: "Euro",
    style: "modern",
    heads: { type: "image", value: "/coins/euro-heads.webp" },
    tails: { type: "image", value: "/coins/euro-tails.webp" },
    headsColor: "#d4a72c",
    tailsColor: "#c0c0c8",
    rimColor: "#f0d98a",
  },
  {
    id: "preset:doubloon",
    name: "Gold Doubloon",
    style: "retro",
    heads: { type: "image", value: "/coins/doubloon-heads.webp" },
    tails: { type: "image", value: "/coins/doubloon-tails.webp" },
    headsColor: "#e0a800",
    tailsColor: "#b8860b",
    rimColor: "#ffd95a",
  },
  {
    id: "preset:neon",
    name: "Neon",
    style: "modern",
    heads: { type: "emoji", value: "🔥" },
    tails: { type: "emoji", value: "⚡" },
    headsColor: "#ec4899",
    tailsColor: "#3b82f6",
    rimColor: "#a78bfa",
  },
];

export const DEFAULT_ACTIVE_ID = PRESETS[0].id;

export function isValidColor(c) {
  return typeof c === "string" && COLOR_RE.test(c);
}

export function isValidConfigId(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

export function isPresetId(id) {
  return PRESETS.some((p) => p.id === id);
}

export function validateText(value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.length === 0 || v.length > MAX_TEXT_LENGTH) return false;
  return !UNSAFE_TEXT_RE.test(v);
}

/** Exactly one grapheme cluster that is a pictograph (handles ZWJ/skin-tone/flags). */
export function validateEmoji(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 16) return false;
  const seg = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)];
  if (seg.length !== 1) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value);
}
