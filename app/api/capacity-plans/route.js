import { readJsonLimited } from "@/lib/requestBody";
import { getUserSummaries } from "@/lib/userLookup";
import { createPlan, listPlansForUser } from "@/lib/capacity/store";
import { CapacityError, isValidId, normalizeGuestName, normalizePlanConfig } from "@/lib/capacity/validate";
import { MAX_MEMBERS } from "@/lib/capacity/constants";
import { errorResponse, json, MAX_SETTINGS_BYTES, requireSession } from "@/lib/capacity/http";
import { planView } from "@/lib/capacity/views";

// GET /api/capacity-plans — plans the user owns, can edit, or can view
export async function GET() {
  try {
    const session = await requireSession();
    return json(await listPlansForUser(session.userId));
  } catch (error) {
    return errorResponse(error, "GET capacity plans error");
  }
}

// POST /api/capacity-plans — create a plan; body is the settings plus optional
// memberIds (app users) and guestNames (team members without an account)
export async function POST(req) {
  try {
    const session = await requireSession();
    const { body, error } = await readJsonLimited(req, MAX_SETTINGS_BYTES);
    if (error) return error;

    const { memberIds: rawMembers = [], guestNames: rawGuests = [], ...settings } = body || {};
    const cfg = normalizePlanConfig(settings);
    if (!Array.isArray(rawMembers) || rawMembers.length > MAX_MEMBERS || !rawMembers.every(isValidId)) {
      throw new CapacityError("Team members are invalid");
    }
    if (!Array.isArray(rawGuests) || rawMembers.length + rawGuests.length > MAX_MEMBERS) {
      throw new CapacityError(`A plan can have at most ${MAX_MEMBERS} team members`);
    }
    const guestNames = rawGuests.map(normalizeGuestName);
    const memberIds = [...new Set(rawMembers)];
    const others = memberIds.filter((id) => id !== session.userId);
    const users = await getUserSummaries(others);
    if (others.some((id) => !users[id])) throw new CapacityError("One or more team members could not be found");

    const plan = await createPlan(session.userId, cfg, memberIds, guestNames);
    return json(await planView(plan, "owner"), 201);
  } catch (error) {
    return errorResponse(error, "POST capacity plan error");
  }
}
