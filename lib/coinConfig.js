import crypto from "crypto";
import { sanitizeImageDataUrl, isStoredImageDataUrl, ImageError } from "@/lib/imageSanitize";
import { isSafePlainObject } from "@/lib/objectGuard";
import {
  MAX_CUSTOM_CONFIGS,
  MAX_NAME_LENGTH,
  MAX_TEXT_LENGTH,
  STYLES,
  FACE_TYPES,
  PRESET_IMAGE_PATHS,
  PRESETS,
  DEFAULT_ACTIVE_ID,
  isValidColor,
  isValidConfigId,
  isPresetId,
  validateText,
  validateEmoji,
  UNSAFE_TEXT_RE,
} from "./coinConstants";

export * from "./coinConstants";

export class ConfigError extends Error {}

function assertPlainObject(o, what) {
  if (!isSafePlainObject(o)) throw new ConfigError(`${what} is invalid`);
}

async function normalizeFace(face, label, knownImages) {
  assertPlainObject(face, label);
  const { type, value } = face;
  if (!FACE_TYPES.includes(type)) throw new ConfigError(`${label}: unsupported type`);
  if (type === "text") {
    if (!validateText(value)) throw new ConfigError(`${label}: invalid text`);
    return { type, value: value.trim() };
  }
  if (type === "emoji") {
    if (!validateEmoji(value)) throw new ConfigError(`${label}: must be a single emoji`);
    return { type, value };
  }
  // image: known preset image or already-stored canonical image owned by this user is kept; anything else is re-encoded
  if (PRESET_IMAGE_PATHS.has(value)) return { type, value };
  if (knownImages.has(value) && isStoredImageDataUrl(value)) return { type, value };
  try {
    return { type, value: await sanitizeImageDataUrl(value) };
  } catch (e) {
    if (e instanceof ImageError) throw new ConfigError(`${label}: ${e.message}`);
    throw e;
  }
}

/**
 * Validate + whitelist-copy a user supplied config. Never copies unknown keys.
 * `knownImages`: Set of stored image data URLs already owned by the user.
 */
export async function normalizeConfig(input, { knownImages = new Set() } = {}) {
  assertPlainObject(input, "Config");

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH || UNSAFE_TEXT_RE.test(name)) {
    throw new ConfigError("Name must be 1–30 characters");
  }
  if (!STYLES.includes(input.style)) throw new ConfigError("Invalid style");
  for (const k of ["headsColor", "tailsColor", "rimColor"]) {
    if (!isValidColor(input[k])) throw new ConfigError(`Invalid ${k}`);
  }
  if (input.id !== undefined && input.id !== null && !isValidConfigId(input.id)) {
    throw new ConfigError("Invalid id");
  }

  return {
    id: input.id || crypto.randomUUID(),
    name,
    style: input.style,
    headsColor: input.headsColor.toLowerCase(),
    tailsColor: input.tailsColor.toLowerCase(),
    rimColor: input.rimColor.toLowerCase(),
    heads: await normalizeFace(input.heads, "Heads", knownImages),
    tails: await normalizeFace(input.tails, "Tails", knownImages),
  };
}
