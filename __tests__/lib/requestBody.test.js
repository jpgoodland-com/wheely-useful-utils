import { readJsonLimited } from "@/lib/requestBody";

// Every API route reads its body through this helper, so its limits are the
// app's defence against oversized or malformed payloads.

const post = (body, headers = {}) => new Request("http://localhost/api/x", { method: "POST", body, headers });

async function expectError(result, status, message) {
  expect(result.body).toBeUndefined();
  expect(result.error.status).toBe(status);
  expect(await result.error.json()).toEqual({ error: message });
}

describe("readJsonLimited", () => {
  it("parses a JSON body within the limit", async () => {
    await expect(readJsonLimited(post('{"name":"Lunch"}'), 1024)).resolves.toEqual({ body: { name: "Lunch" } });
  });

  it("treats an empty body as an empty object", async () => {
    await expect(readJsonLimited(post(""), 1024)).resolves.toEqual({ body: {} });
  });

  it("rejects a declared Content-Length over the limit without reading the body", async () => {
    const req = post('{"a":1}', { "content-length": "5000" });
    const text = jest.spyOn(req, "text");

    await expectError(await readJsonLimited(req, 1024), 413, "Payload too large");
    expect(text).not.toHaveBeenCalled();
  });

  it("still measures the body when Content-Length is missing or understated", async () => {
    const big = JSON.stringify({ name: "x".repeat(2000) });
    await expectError(await readJsonLimited(post(big), 1024), 413, "Payload too large");
    await expectError(await readJsonLimited(post(big, { "content-length": "10" }), 1024), 413, "Payload too large");
  });

  it("counts bytes, not characters, so multi-byte text can't slip past the limit", async () => {
    // 300 emoji are 600 UTF-16 code units but 1200 UTF-8 bytes.
    const body = JSON.stringify({ face: "🪙".repeat(300) });
    expect(body.length).toBeLessThan(1024);
    await expectError(await readJsonLimited(post(body), 1024), 413, "Payload too large");
  });

  it("accepts a body of exactly the limit", async () => {
    const body = JSON.stringify({ v: "x".repeat(1024 - 8) });
    expect(Buffer.byteLength(body)).toBe(1024);
    await expect(readJsonLimited(post(body), 1024)).resolves.toEqual({ body: JSON.parse(body) });
  });

  it("rejects malformed JSON with a 400", async () => {
    await expectError(await readJsonLimited(post("{not json"), 1024), 400, "Invalid JSON");
  });

  it("rejects a body that can't be read (e.g. the client disconnected)", async () => {
    const req = post("{}");
    jest.spyOn(req, "text").mockRejectedValue(new TypeError("terminated"));
    await expectError(await readJsonLimited(req, 1024), 400, "Invalid request");
  });
});
