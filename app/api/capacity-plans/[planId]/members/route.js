import { readJsonLimited } from "@/lib/requestBody";
import { addGuestMember, addMember } from "@/lib/capacity/store";
import { normalizeGuestName, normalizeUserRef } from "@/lib/capacity/validate";
import { errorResponse, MAX_SMALL_BODY_BYTES, planIdFrom, requireSession } from "@/lib/capacity/http";
import { resolveTargetUserId, viewResponse } from "@/lib/capacity/routeHelpers";

// POST /api/capacity-plans/[planId]/members — owner or editor adds a team member
// body: { userId } | { identifier } for an app user, or { guestName } for someone without an account
export async function POST(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    const { body, error } = await readJsonLimited(req, MAX_SMALL_BODY_BYTES);
    if (error) return error;

    let plan;
    if (body?.guestName !== undefined) {
      plan = await addGuestMember(planId, session.userId, normalizeGuestName(body.guestName));
    } else {
      const memberId = await resolveTargetUserId(normalizeUserRef(body));
      plan = await addMember(planId, session.userId, memberId);
    }
    return viewResponse(plan, session.userId);
  } catch (error) {
    return errorResponse(error, "POST plan member error");
  }
}
