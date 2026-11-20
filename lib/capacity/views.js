import { getUserSummaries } from "@/lib/userLookup";
import { getAvailability, publicPlan } from "./store";

const guestIds = (plan) => Object.keys(plan.guests || {});

/**
 * Display names for every team row: app users from the Users table, plus team
 * members without an account from the plan itself. Returns { [memberId]: { fullName, ... } }.
 */
export async function memberNames(plan) {
  const guests = guestIds(plan);
  const users = await getUserSummaries(plan.memberIds.filter((id) => !guests.includes(id)));
  for (const id of guests) users[id] = { fullName: plan.guests[id].name, guest: true };
  return users;
}

/**
 * Everything the plan page needs: settings, the caller's role, member and
 * access lists with display names, and availability exceptions.
 * Email addresses are only shown to people who can manage sharing.
 */
export async function planView(plan, role) {
  const accessIds = Object.keys(plan.access || {});
  const [users, availability] = await Promise.all([
    getUserSummaries([plan.ownerId, ...plan.memberIds.filter((id) => !plan.guests?.[id]), ...accessIds]),
    getAvailability(plan.planId, plan.memberIds),
  ]);
  const showEmail = role === "owner" || role === "edit";
  const person = (userId) => {
    const guest = plan.guests?.[userId];
    if (guest) return { userId, fullName: guest.name, username: null, guest: true };
    const u = users[userId];
    if (!u) return { userId, fullName: "Former user", username: null, missing: true };
    return { userId, fullName: u.fullName, username: u.username, ...(showEmail ? { email: u.email } : {}) };
  };
  return {
    plan: publicPlan(plan),
    role,
    members: plan.memberIds.map(person),
    access: [
      { ...person(plan.ownerId), role: "owner" },
      ...accessIds.map((id) => ({ ...person(id), role: plan.access[id] })),
    ],
    availability,
  };
}
