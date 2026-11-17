import { NotFoundError, removeAccess } from "@/lib/capacity/store";
import { isValidId } from "@/lib/capacity/validate";
import { errorResponse, planIdFrom, requireSession } from "@/lib/capacity/http";
import { viewResponse } from "@/lib/capacity/routeHelpers";

// DELETE /api/capacity-plans/[planId]/access/[userId] — stop sharing with someone
export async function DELETE(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    const { userId } = await params;
    if (!isValidId(userId)) throw new NotFoundError("That person doesn't have access");

    const plan = await removeAccess(planId, session.userId, userId);
    return viewResponse(plan, session.userId);
  } catch (error) {
    return errorResponse(error, "DELETE plan access error");
  }
}
