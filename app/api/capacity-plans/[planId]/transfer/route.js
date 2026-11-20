import { readJsonLimited } from "@/lib/requestBody";
import { getPlanWithRole, requireRole, transferOwnership } from "@/lib/capacity/store";
import { CapacityError, isValidId } from "@/lib/capacity/validate";
import { errorResponse, MAX_SMALL_BODY_BYTES, planIdFrom, requireSession } from "@/lib/capacity/http";
import { viewResponse } from "@/lib/capacity/routeHelpers";

// POST /api/capacity-plans/[planId]/transfer — owner hands the plan to an editor
// body: { newOwnerId }
export async function POST(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    const { body, error } = await readJsonLimited(req, MAX_SMALL_BODY_BYTES);
    if (error) return error;
    if (!isValidId(body?.newOwnerId)) throw new CapacityError("Choose a new owner");

    const { role } = await getPlanWithRole(planId, session.userId);
    requireRole(role, ["owner"]);
    const plan = await transferOwnership(planId, session.userId, body.newOwnerId);
    return viewResponse(plan, session.userId);
  } catch (error) {
    return errorResponse(error, "POST plan transfer error");
  }
}
