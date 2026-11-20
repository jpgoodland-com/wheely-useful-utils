/**
 * Read and parse a JSON request body with a hard byte limit, before parsing.
 * Returns { body } or { error: NextResponse-compatible Response }.
 */
export async function readJsonLimited(req, maxBytes) {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { error: Response.json({ error: "Payload too large" }, { status: 413 }) };
  }
  let text;
  try {
    text = await req.text();
  } catch {
    return { error: Response.json({ error: "Invalid request" }, { status: 400 }) };
  }
  if (Buffer.byteLength(text) > maxBytes) {
    return { error: Response.json({ error: "Payload too large" }, { status: 413 }) };
  }
  if (!text) return { body: {} };
  try {
    const body = JSON.parse(text);
    return { body };
  } catch {
    return { error: Response.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
}
