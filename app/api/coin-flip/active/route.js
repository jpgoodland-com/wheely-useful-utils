import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { setActive, ConflictError } from "@/lib/coinStore";
import { readJsonLimited } from "@/lib/requestBody";

export async function PUT(req) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { body, error } = await readJsonLimited(req, 1024);
    if (error) return error;
    if (typeof body?.id !== "string") return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const ok = await setActive(session.userId, body.id);
    if (!ok) return NextResponse.json({ error: "Not Found" }, { status: 404 });
    return NextResponse.json({ activeId: body.id });
  } catch (error) {
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: "Please retry" }, { status: 409 });
    }
    console.error("PUT coin-flip active error", error);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
