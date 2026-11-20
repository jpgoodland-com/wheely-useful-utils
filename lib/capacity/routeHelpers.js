import { resolveUserRef } from "@/lib/userLookup";
import { NotFoundError, roleOf } from "./store";
import { json } from "./http";
import { planView } from "./views";

/** Resolve { userId } | { identifier } to an existing user's id. */
export async function resolveTargetUserId(ref) {
  const user = await resolveUserRef(ref);
  if (!user) throw new NotFoundError("No user found with that email or username");
  return user.userId;
}

/** Respond with the caller's fresh view of the plan, or note that they no longer have access. */
export async function viewResponse(plan, userId) {
  const role = roleOf(plan, userId);
  if (!role) return json({ removed: true });
  return json(await planView(plan, role));
}
