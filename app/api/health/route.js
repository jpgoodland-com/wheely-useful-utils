import { NextResponse } from "next/server";

// ALB target group health check. Public on purpose (no getSession())
// and touches no data, so a slow DynamoDB or a bad page render can't mark
// every task unhealthy at once. proxy.js lets this path skip the HTTPS
// redirect and rate limits, because the ALB checks over plain HTTP.
export function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
