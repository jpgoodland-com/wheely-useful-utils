import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { clearHistory } from "@/lib/coinStore";

export async function DELETE() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await clearHistory(session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE coin-flip history error", error);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
