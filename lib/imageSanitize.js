import sharp from "sharp";

export const MAX_IMAGE_INPUT_BYTES = 64 * 1024; // decoded upload ceiling before re-encode
export const MAX_IMAGE_OUTPUT_BYTES = 32 * 1024; // stored result ceiling
export const MAX_INPUT_DIMENSION = 256;
export const OUTPUT_SIZE = 128;

const DATA_URL_RE = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

sharp.concurrency(1);
sharp.cache(false);

export class ImageError extends Error {}

function hasValidMagic(kind, buf) {
  if (kind === "png") return buf.length > 24 && buf.subarray(0, 8).equals(PNG_MAGIC);
  return (
    buf.length > 30 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  );
}

/** PNG dimensions straight from the IHDR header (pre-parse, no libvips). */
function pngDimensions(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Validate an uploaded image data URL and return a freshly re-encoded
 * 128x128 WebP data URL. No uploaded bytes are ever passed through.
 * Throws ImageError on any problem.
 */
export async function sanitizeImageDataUrl(input) {
  if (typeof input !== "string" || input.length > Math.ceil((MAX_IMAGE_INPUT_BYTES * 4) / 3) + 64) {
    throw new ImageError("Invalid image");
  }
  const m = DATA_URL_RE.exec(input);
  if (!m) throw new ImageError("Only PNG or WebP images are accepted");
  const [, kind, b64] = m;
  if (b64.length % 4 !== 0) throw new ImageError("Invalid image encoding");

  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0 || buf.length > MAX_IMAGE_INPUT_BYTES) {
    throw new ImageError("Image too large");
  }
  if (!hasValidMagic(kind, buf)) throw new ImageError("Image content does not match its type");

  if (kind === "png") {
    const { width, height } = pngDimensions(buf);
    if (!width || !height || width > MAX_INPUT_DIMENSION || height > MAX_INPUT_DIMENSION) {
      throw new ImageError("Image dimensions too large");
    }
  }

  let out;
  try {
    out = await sharp(buf, {
      limitInputPixels: MAX_INPUT_DIMENSION * MAX_INPUT_DIMENSION,
      failOn: "error",
    })
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover" })
      .webp({ quality: 80 })
      .toBuffer(); // metadata is stripped by default
  } catch {
    throw new ImageError("Could not process image");
  }

  if (out.length > MAX_IMAGE_OUTPUT_BYTES) throw new ImageError("Image too large after processing");
  return `data:image/webp;base64,${out.toString("base64")}`;
}

/** True only for data URLs this module produced (canonical stored form). */
export function isStoredImageDataUrl(value) {
  return (
    typeof value === "string" &&
    value.length <= Math.ceil((MAX_IMAGE_OUTPUT_BYTES * 4) / 3) + 32 &&
    /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}
