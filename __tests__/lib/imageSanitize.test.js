import sharp from "sharp";
import {
  sanitizeImageDataUrl,
  isStoredImageDataUrl,
  ImageError,
  MAX_IMAGE_OUTPUT_BYTES,
  OUTPUT_SIZE,
} from "@/lib/imageSanitize";

describe("lib/imageSanitize", () => {
  let samplePngDataUrl;
  let sampleWebpDataUrl;

  beforeAll(async () => {
    // Generate valid 32x32 PNG and WebP test fixtures in memory
    const pngBuf = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    samplePngDataUrl = `data:image/png;base64,${pngBuf.toString("base64")}`;

    const webpBuf = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 },
      },
    })
      .webp()
      .toBuffer();
    sampleWebpDataUrl = `data:image/webp;base64,${webpBuf.toString("base64")}`;
  });

  it("accepts valid PNG and returns a sanitized WebP data URL", async () => {
    const result = await sanitizeImageDataUrl(samplePngDataUrl);
    expect(result.startsWith("data:image/webp;base64,")).toBe(true);

    // Verify dimensions of re-encoded output with sharp
    const b64 = result.replace("data:image/webp;base64,", "");
    const outBuf = Buffer.from(b64, "base64");
    expect(outBuf.length).toBeLessThanOrEqual(MAX_IMAGE_OUTPUT_BYTES);

    const metadata = await sharp(outBuf).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(OUTPUT_SIZE);
    expect(metadata.height).toBe(OUTPUT_SIZE);
  });

  it("accepts valid WebP and re-encodes to canonical WebP data URL", async () => {
    const result = await sanitizeImageDataUrl(sampleWebpDataUrl);
    expect(result.startsWith("data:image/webp;base64,")).toBe(true);
    expect(isStoredImageDataUrl(result)).toBe(true);
  });

  it("rejects SVG data URLs (prevents script injection)", async () => {
    const svgData = "data:image/svg+xml;base64," + Buffer.from("<svg></svg>").toString("base64");
    await expect(sanitizeImageDataUrl(svgData)).rejects.toThrow(ImageError);
  });

  it("rejects JPEG data URLs", async () => {
    const jpegBuf = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .jpeg()
      .toBuffer();
    const jpegData = `data:image/jpeg;base64,${jpegBuf.toString("base64")}`;
    await expect(sanitizeImageDataUrl(jpegData)).rejects.toThrow(ImageError);
  });

  it("rejects corrupt or mismatched image data", async () => {
    const fakePng = "data:image/png;base64," + Buffer.from("NOT_A_PNG_HEADER_CONTENT").toString("base64");
    await expect(sanitizeImageDataUrl(fakePng)).rejects.toThrow(ImageError);
  });

  it("rejects PNG with declared dimensions exceeding 256x256", async () => {
    const bigPngBuf = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 4,
        background: { r: 10, g: 10, b: 10, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const bigPngData = `data:image/png;base64,${bigPngBuf.toString("base64")}`;
    await expect(sanitizeImageDataUrl(bigPngData)).rejects.toThrow(ImageError);
  });

  it("isStoredImageDataUrl validates canonical output format", () => {
    expect(isStoredImageDataUrl("data:image/png;base64,AA==")).toBe(false);
    expect(isStoredImageDataUrl("javascript:alert(1)")).toBe(false);
    expect(isStoredImageDataUrl("")).toBe(false);
  });
});
