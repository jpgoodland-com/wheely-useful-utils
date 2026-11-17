import { readJsonLimited } from "@/lib/requestBody";
import { linkGuestMember, NotFoundError } from "@/lib/capacity/store";
import { isValidId, normalizeUserRef } from "@/lib/capacity/validate";
import { errorResponse, MAX_SMALL_BODY_BYTES, planIdFrom, requireSession } from "@/lib/capacity/http";
import { resolveTargetUserId, viewResponse } from "@/lib/capacity/routeHelpers";

// POST /api/capacity-plans/[planId]/members/[userId]/link — link a team member
// without an account ([userId] is their member id) to a user account.
// body: { userId } | { identifier }
export async function POST(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    const { userId: guestId } = await params;
    if (!isValidId(guestId)) throw new NotFoundError("Not a team member without an account");
    const { body, error } = await readJsonLimited(req, MAX_SMALL_BODY_BYTES);
    if (error) return error;

    const accountId = await resolveTargetUserId(normalizeUserRef(body));
    const plan = await linkGuestMember(planId, session.userId, guestId, accountId);
    return viewResponse(plan, session.userId);
  } catch (error) {
    return errorResponse(error, "POST link plan member error");
  }
}
