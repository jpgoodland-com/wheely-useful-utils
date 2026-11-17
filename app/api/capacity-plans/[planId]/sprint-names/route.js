import { readJsonLimited } from "@/lib/requestBody";
import { patchSprintNames } from "@/lib/capacity/store";
import { normalizeSprintNamesPatch } from "@/lib/capacity/validate";
import { errorResponse, json, MAX_SMALL_BODY_BYTES, planIdFrom, requireSession } from "@/lib/capacity/http";

// PUT /api/capacity-plans/[planId]/sprint-names
// body: { names: { "<sprint start date>": "Name" | null } }
export async function PUT(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    const { body, error } = await readJsonLimited(req, MAX_SMALL_BODY_BYTES);
    if (error) return error;

    const plan = await patchSprintNames(planId, session.userId, normalizeSprintNamesPatch(body?.names));
    return json({ sprintNames: plan.sprintNames, version: plan.version });
  } catch (error) {
    return errorResponse(error, "PUT sprint names error");
  }
}
