import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { CapacityError, isValidId } from "./validate";
import { ConflictError, DecisionRequiredError, ForbiddenError, NotFoundError } from "./store";

export const MAX_SETTINGS_BYTES = 16 * 1024;
export const MAX_SMALL_BODY_BYTES = 8 * 1024;

export const json = (body, status = 200) => NextResponse.json(body, { status });

export class UnauthorizedError extends Error {}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

/** Resolve and validate the [planId] param; malformed ids are simply "not found". */
export async function planIdFrom(params) {
  const { planId } = await params;
  if (!isValidId(planId)) throw new NotFoundError("Plan not found");
  return planId;
}

/** Map domain errors to HTTP responses; anything unexpected is logged and hidden. */
export function errorResponse(error, label) {
  if (error instanceof UnauthorizedError) return json({ error: "Unauthorized" }, 401);
  if (error instanceof CapacityError) return json({ error: error.message }, 400);
  if (error instanceof ForbiddenError) return json({ error: error.message }, 403);
  if (error instanceof NotFoundError) return json({ error: error.message }, 404);
  if (error instanceof DecisionRequiredError) return json({ error: error.message, plansRequiringDecision: error.plans }, 409);
  if (error instanceof ConflictError) return json({ error: error.message || "Please retry" }, 409);
  console.error(label, error);
  return json({ error: "Internal Error" }, 500);
}
