import { readJsonLimited } from "@/lib/requestBody";
import { patchAvailability } from "@/lib/capacity/store";
import { errorResponse, json, MAX_SMALL_BODY_BYTES, planIdFrom, requireSession } from "@/lib/capacity/http";

// PATCH /api/capacity-plans/[planId]/availability
// body: { memberId, days: { "YYYY-MM-DD": 0 | 0.25 | 0.5 | 0.75 | 1 } } — only changed days
export async function PATCH(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    const { body, error } = await readJsonLimited(req, MAX_SMALL_BODY_BYTES);
    if (error) return error;

    return json(await patchAvailability(planId, session.userId, body));
  } catch (error) {
    return errorResponse(error, "PATCH availability error");
  }
}
