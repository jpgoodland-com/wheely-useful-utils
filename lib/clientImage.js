/**
 * Client-side image pre-processor.
 * Center-crops square, downscales to 128x128 on an offscreen canvas,
 * and exports as a clean WebP (or PNG fallback) data URL.
 * Strips EXIF metadata before network upload.
 */
export async function processImageFile(file) {
  if (!file) throw new Error("No file selected");
  const validTypes = ["image/png", "image/jpeg", "image/webp"];
  if (!validTypes.includes(file.type)) {
    throw new Error("Only PNG, JPEG, and WebP images are supported");
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("Image must be smaller than 2 MB");
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const canvas = document.createElement("canvas");
        const size = 128;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context unavailable");

        // Center-crop square math
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

        // Try webp first, fallback to png
        let dataUrl = canvas.toDataURL("image/webp", 0.85);
        if (!dataUrl.startsWith("data:image/webp")) {
          dataUrl = canvas.toDataURL("image/png");
        }
        resolve(dataUrl);
      } catch (err) {
        reject(new Error("Failed to process image"));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not load image"));
    };
    img.src = objectUrl;
  });
}
