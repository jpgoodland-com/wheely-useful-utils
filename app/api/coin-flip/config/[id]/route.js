import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { deleteConfig, ConflictError } from "@/lib/coinStore";
import { isValidConfigId } from "@/lib/coinConfig";

export async function DELETE(req, { params }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!isValidConfigId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const removed = await deleteConfig(session.userId, id);
    if (!removed) return NextResponse.json({ error: "Not Found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: "Please retry" }, { status: 409 });
    }
    console.error("DELETE coin-flip config error", error);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
