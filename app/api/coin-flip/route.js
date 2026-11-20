import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getCoinState } from "@/lib/coinStore";
import { PRESETS, MAX_CUSTOM_CONFIGS } from "@/lib/coinConfig";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const state = await getCoinState(session.userId);
    return NextResponse.json({ ...state, presets: PRESETS, maxCustomConfigs: MAX_CUSTOM_CONFIGS });
  } catch (error) {
    console.error("GET coin-flip error", error);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
