import { readJsonLimited } from "@/lib/requestBody";
import { setAccess } from "@/lib/capacity/store";
import { normalizeAccessChange } from "@/lib/capacity/validate";
import { errorResponse, MAX_SMALL_BODY_BYTES, planIdFrom, requireSession } from "@/lib/capacity/http";
import { resolveTargetUserId, viewResponse } from "@/lib/capacity/routeHelpers";

// PUT /api/capacity-plans/[planId]/access — share the plan or change someone's access
// body: { userId | identifier, role: "edit" | "view" }
export async function PUT(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    const { body, error } = await readJsonLimited(req, MAX_SMALL_BODY_BYTES);
    if (error) return error;

    const { role, ...ref } = normalizeAccessChange(body);
    const targetId = await resolveTargetUserId(ref);
    const plan = await setAccess(planId, session.userId, targetId, role);
    return viewResponse(plan, session.userId);
  } catch (error) {
    return errorResponse(error, "PUT plan access error");
  }
}
