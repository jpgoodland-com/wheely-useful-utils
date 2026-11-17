import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getCoinState, saveConfig, ConflictError } from "@/lib/coinStore";
import { normalizeConfig, ConfigError } from "@/lib/coinConfig";
import { readJsonLimited } from "@/lib/requestBody";

// Two images (~44 KB base64 each at the 32 KB cap) + metadata, with headroom
// for a raw upload before it is re-encoded.
const MAX_BODY_BYTES = 200 * 1024;

export async function PUT(req) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { body, error } = await readJsonLimited(req, MAX_BODY_BYTES);
    if (error) return error;

    const state = await getCoinState(session.userId);
    const knownImages = new Set(
      state.configs.flatMap((c) => [c.heads, c.tails]).filter((f) => f?.type === "image").map((f) => f.value)
    );

    const config = await normalizeConfig(body, { knownImages });
    const configs = await saveConfig(session.userId, config);
    return NextResponse.json({ config, configs });
  } catch (error) {
    if (error instanceof ConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: "Please retry" }, { status: 409 });
    }
    console.error("PUT coin-flip config error", error);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
