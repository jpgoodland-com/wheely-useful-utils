/** @jest-environment jsdom */
import { processImageFile } from "@/lib/clientImage";

// jsdom can't decode images or draw on a canvas, so Image, the 2D context and
// toDataURL are stubbed. Each test says whether the image loads and how big it is.

let imageBehaviour;
let drawImage;
let toDataURL;
let getContext;

class FakeImage {
  set src(url) {
    this._src = url;
    setTimeout(() => {
      if (imageBehaviour.fail) this.onerror?.();
      else {
        this.width = imageBehaviour.width;
        this.height = imageBehaviour.height;
        this.onload?.();
      }
    });
  }
  get src() {
    return this._src;
  }
}

const file = (type = "image/png", size = 1024) => {
  const f = new File(["x"], "face", { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

beforeEach(() => {
  imageBehaviour = { width: 300, height: 200 };
  global.Image = FakeImage;
  URL.createObjectURL = jest.fn(() => "blob:face");
  URL.revokeObjectURL = jest.fn();
  drawImage = jest.fn();
  toDataURL = jest.fn((type) => `data:${type};base64,AAAA`);
  getContext = jest.fn(() => ({ drawImage }));
  jest.spyOn(document, "createElement").mockImplementation((tag) => {
    if (tag !== "canvas") throw new Error(`unexpected element ${tag}`);
    return { width: 0, height: 0, getContext, toDataURL };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("processImageFile validation", () => {
  it("rejects a missing file", async () => {
    await expect(processImageFile(undefined)).rejects.toThrow("No file selected");
  });

  it.each(["image/gif", "image/svg+xml", "application/pdf", ""])("rejects %p files", async (type) => {
    await expect(processImageFile(file(type))).rejects.toThrow("Only PNG, JPEG, and WebP images are supported");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects files over 2 MB and accepts exactly 2 MB", async () => {
    await expect(processImageFile(file("image/png", 2 * 1024 * 1024 + 1))).rejects.toThrow("Image must be smaller than 2 MB");
    await expect(processImageFile(file("image/png", 2 * 1024 * 1024))).resolves.toMatch(/^data:image\//);
  });

  it.each(["image/png", "image/jpeg", "image/webp"])("accepts %s", async (type) => {
    await expect(processImageFile(file(type))).resolves.toMatch(/^data:image\//);
  });
});

describe("processImageFile output", () => {
  it("centre-crops a landscape image to a 128x128 square", async () => {
    imageBehaviour = { width: 300, height: 200 };
    await processImageFile(file());

    const canvas = document.createElement.mock.results[0].value;
    expect(canvas.width).toBe(128);
    expect(canvas.height).toBe(128);
    expect(drawImage).toHaveBeenCalledWith(expect.any(FakeImage), 50, 0, 200, 200, 0, 0, 128, 128);
  });

  it("centre-crops a portrait image", async () => {
    imageBehaviour = { width: 100, height: 400 };
    await processImageFile(file());
    expect(drawImage).toHaveBeenCalledWith(expect.any(FakeImage), 0, 150, 100, 100, 0, 0, 128, 128);
  });

  it("re-encodes as WebP, which drops EXIF and other metadata", async () => {
    await expect(processImageFile(file("image/jpeg"))).resolves.toBe("data:image/webp;base64,AAAA");
    expect(toDataURL).toHaveBeenCalledWith("image/webp", 0.85);
    expect(toDataURL).toHaveBeenCalledTimes(1);
  });

  it("falls back to PNG when the browser can't encode WebP", async () => {
    // Browsers without WebP encoding return a PNG data URL for any type.
    toDataURL.mockImplementation(() => "data:image/png;base64,BBBB");
    await expect(processImageFile(file())).resolves.toBe("data:image/png;base64,BBBB");
    expect(toDataURL).toHaveBeenLastCalledWith("image/png");
  });

  it("releases the object URL once the image has loaded", async () => {
    await processImageFile(file());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:face");
  });
});

describe("processImageFile failures", () => {
  it("reports an image the browser can't decode and releases its object URL", async () => {
    imageBehaviour = { fail: true };
    await expect(processImageFile(file())).rejects.toThrow("Could not load image");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:face");
  });

  it("reports a missing canvas context as a processing failure", async () => {
    getContext.mockReturnValue(null);
    await expect(processImageFile(file())).rejects.toThrow("Failed to process image");
  });

  it("reports a canvas that throws while encoding", async () => {
    toDataURL.mockImplementation(() => {
      throw new Error("SecurityError: tainted canvas");
    });
    await expect(processImageFile(file())).rejects.toThrow("Failed to process image");
  });
});
