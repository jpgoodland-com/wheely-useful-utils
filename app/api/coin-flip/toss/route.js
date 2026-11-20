import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { tossAndStore, ConflictError } from "@/lib/coinStore";
import { readJsonLimited } from "@/lib/requestBody";
import { MAX_TOSS_COUNT } from "@/lib/coinFlip";

const MAX_BODY_BYTES = 1024;

export async function POST(req) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { body, error } = await readJsonLimited(req, MAX_BODY_BYTES);
    if (error) return error;

    // Client-supplied history is deliberately ignored: the server uses its own stored history.
    let count = 1;
    if (body && body.count !== undefined) {
      count = Number(body.count);
      if (!Number.isInteger(count) || count < 1 || count > MAX_TOSS_COUNT) {
        return NextResponse.json({ error: `count must be an integer 1–${MAX_TOSS_COUNT}` }, { status: 400 });
      }
    }

    const { results, totals } = await tossAndStore(session.userId, count);
    return NextResponse.json({ results, totals });
  } catch (error) {
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: "Please retry" }, { status: 409 });
    }
    console.error("POST coin-flip toss error", error);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
