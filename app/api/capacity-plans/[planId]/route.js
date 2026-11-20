import { readJsonLimited } from "@/lib/requestBody";
import { deletePlan, getPlanWithRole, updatePlanSettings } from "@/lib/capacity/store";
import { CapacityError, normalizePlanConfig } from "@/lib/capacity/validate";
import { errorResponse, json, MAX_SETTINGS_BYTES, planIdFrom, requireSession } from "@/lib/capacity/http";
import { planView } from "@/lib/capacity/views";

// GET /api/capacity-plans/[planId] — plan, role, people and availability
export async function GET(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    const { plan, role } = await getPlanWithRole(planId, session.userId);
    return json(await planView(plan, role));
  } catch (error) {
    return errorResponse(error, "GET capacity plan error");
  }
}

// PATCH /api/capacity-plans/[planId] — owner updates core settings
// body: { expectedVersion, settings: { name?, timeZone?, unit?, ... } }
export async function PATCH(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    const { body, error } = await readJsonLimited(req, MAX_SETTINGS_BYTES);
    if (error) return error;
    if (!Number.isInteger(body?.expectedVersion)) throw new CapacityError("expectedVersion is required");

    const patch = normalizePlanConfig(body.settings, { partial: true });
    const plan = await updatePlanSettings(planId, session.userId, patch, body.expectedVersion);
    return json(await planView(plan, "owner"));
  } catch (error) {
    return errorResponse(error, "PATCH capacity plan error");
  }
}

// DELETE /api/capacity-plans/[planId] — owner deletes the plan for everyone
export async function DELETE(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    await deletePlan(planId, session.userId);
    return json({ success: true });
  } catch (error) {
    return errorResponse(error, "DELETE capacity plan error");
  }
}
