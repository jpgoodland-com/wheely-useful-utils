import { readJsonLimited } from "@/lib/requestBody";
import { NotFoundError, removeMember, renameGuestMember } from "@/lib/capacity/store";
import { isValidId, normalizeGuestName } from "@/lib/capacity/validate";
import { errorResponse, MAX_SMALL_BODY_BYTES, planIdFrom, requireSession } from "@/lib/capacity/http";
import { viewResponse } from "@/lib/capacity/routeHelpers";

// PATCH /api/capacity-plans/[planId]/members/[userId] — rename a team member without an account
// body: { name }
export async function PATCH(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    const { userId } = await params;
    if (!isValidId(userId)) throw new NotFoundError("Not a team member without an account");
    const { body, error } = await readJsonLimited(req, MAX_SMALL_BODY_BYTES);
    if (error) return error;

    const plan = await renameGuestMember(planId, session.userId, userId, normalizeGuestName(body?.name));
    return viewResponse(plan, session.userId);
  } catch (error) {
    return errorResponse(error, "PATCH plan member error");
  }
}

// DELETE /api/capacity-plans/[planId]/members/[userId] — remove a team row and its availability
export async function DELETE(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    const { userId } = await params;
    if (!isValidId(userId)) throw new NotFoundError("Not a team member");

    const plan = await removeMember(planId, session.userId, userId);
    return viewResponse(plan, session.userId);
  } catch (error) {
    return errorResponse(error, "DELETE plan member error");
  }
}
