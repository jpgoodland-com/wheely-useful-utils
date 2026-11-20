import { leavePlan } from "@/lib/capacity/store";
import { errorResponse, json, planIdFrom, requireSession } from "@/lib/capacity/http";

// POST /api/capacity-plans/[planId]/leave — remove your own access (not for the owner)
export async function POST(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    await leavePlan(planId, session.userId);
    return json({ success: true });
  } catch (error) {
    return errorResponse(error, "POST leave plan error");
  }
}
