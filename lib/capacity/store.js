import crypto from "crypto";
import { docClient, TableNames } from "@/lib/dynamodb";
import { BatchGetCommand, DeleteCommand, GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { CapacityError, normalizeAvailabilityPatch } from "./validate";
import { diffDays, nowUtcIso } from "./dates";
import { sprintLengthDays } from "./sprints";
import { MAX_ACCESS, MAX_MEMBERS, MAX_OVERRIDES_PER_MEMBER, MAX_OWNED_PLANS, MAX_SPRINT_NAMES } from "./constants";

// Item layout (single table, hash key PK; sparse GSI UserIdIndex on `userId`):
//   PLAN#<planId>                     plan settings, memberIds, access map — source of truth
//   PLANACCESS#<planId>#<userId>      reverse index for "plans for user"; the only items with `userId`.
//                                     role "member" marks a team row with no access, so account deletion finds it
//   PLANAVAIL#<planId>#<memberId>     { days: { "YYYY-MM-DD": fraction } } exceptions only
//   PLANQUOTA#<userId>                { ownedCount } enforces MAX_OWNED_PLANS atomically

export class ConflictError extends Error {}
export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class DecisionRequiredError extends Error {
  constructor(plans) {
    super("Choose what happens to plans other people can edit");
    this.plans = plans;
  }
}

const TABLE = () => TableNames.CapacityPlans;
const planKey = (planId) => ({ PK: `PLAN#${planId}` });
const accessKey = (planId, userId) => ({ PK: `PLANACCESS#${planId}#${userId}` });
const availKey = (planId, memberId) => ({ PK: `PLANAVAIL#${planId}#${memberId}` });
const quotaKey = (userId) => ({ PK: `PLANQUOTA#${userId}` });

const PLAN_LIMIT_MESSAGE = `You can own at most ${MAX_OWNED_PLANS} plans`;

// ── Low-level helpers ─────────────────────────────────────────────────────────

class TxCancelled extends Error {
  constructor(reasons) {
    super("Transaction cancelled");
    this.reasons = reasons;
  }
}

const failedAt = (e, i) => e instanceof TxCancelled && e.reasons[i]?.Code === "ConditionalCheckFailed";

async function transact(items) {
  try {
    await docClient.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (e) {
    if (e?.name === "TransactionCanceledException") throw new TxCancelled(e.CancellationReasons || []);
    throw e;
  }
}

const txPut = (Item, extra = {}) => ({ Put: { TableName: TABLE(), Item, ...extra } });
const txDelete = (Key) => ({ Delete: { TableName: TABLE(), Key } });
const accessItem = (planId, userId, role) => txPut({ ...accessKey(planId, userId), planId, userId, role, createdAt: nowUtcIso() });
/** After `userId` loses access: keep a "member" index item while they still have a team row. */
const accessRemoved = (plan, userId) =>
  plan.memberIds.includes(userId) ? accessItem(plan.planId, userId, "member") : txDelete(accessKey(plan.planId, userId));

function quotaChange(userId, delta) {
  const update = {
    TableName: TABLE(),
    Key: quotaKey(userId),
    UpdateExpression: "ADD ownedCount :d",
    ExpressionAttributeValues: { ":d": delta },
  };
  if (delta > 0) {
    update.ConditionExpression = "attribute_not_exists(ownedCount) OR ownedCount < :max";
    update.ExpressionAttributeValues[":max"] = MAX_OWNED_PLANS;
  }
  return { Update: update };
}

async function getItem(Key) {
  const res = await docClient.send(new GetCommand({ TableName: TABLE(), Key, ConsistentRead: true }));
  return res.Item || null;
}

async function batchGet(keys) {
  const items = [];
  for (let i = 0; i < keys.length; i += 100) {
    let pending = keys.slice(i, i + 100);
    for (let attempt = 0; pending.length && attempt < 5; attempt++) {
      const res = await docClient.send(new BatchGetCommand({ RequestItems: { [TABLE()]: { Keys: pending, ConsistentRead: true } } }));
      items.push(...(res.Responses?.[TABLE()] || []));
      pending = res.UnprocessedKeys?.[TABLE()]?.Keys || [];
    }
  }
  return items;
}

async function deleteKeys(keys) {
  for (let i = 0; i < keys.length; i += 10) {
    await Promise.all(keys.slice(i, i + 10).map((Key) => docClient.send(new DeleteCommand({ TableName: TABLE(), Key }))));
  }
}

async function queryAccessItems(userId) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLE(),
        IndexName: "UserIdIndex",
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": userId },
        ExclusiveStartKey,
      })
    );
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/**
 * Read-modify-write the plan item under an optimistic version check, together
 * with any extra transaction items. `mutate(plan)` returns { plan, items } or throws.
 */
async function mutatePlan(planId, mutate) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await getItem(planKey(planId));
    if (!current) throw new NotFoundError("Plan not found");
    const { plan, items = [] } = mutate(structuredClone(current));
    const next = { ...plan, version: current.version + 1, updatedAt: nowUtcIso() };
    try {
      await transact([
        txPut(next, {
          ConditionExpression: "#v = :v",
          ExpressionAttributeNames: { "#v": "version" },
          ExpressionAttributeValues: { ":v": current.version },
        }),
        ...items,
      ]);
      return next;
    } catch (e) {
      if (!failedAt(e, 0)) throw e;
    }
  }
  throw new ConflictError("Concurrent update");
}

// ── Roles ─────────────────────────────────────────────────────────────────────

export function roleOf(plan, userId) {
  if (!plan) return null;
  if (plan.ownerId === userId) return "owner";
  return plan.access?.[userId] || null;
}

const editRoles = ["owner", "edit"];

export function requireRole(role, allowed) {
  if (!allowed.includes(role)) throw new ForbiddenError("You don't have permission to do that");
}

export function publicPlan(plan) {
  const { PK, ...rest } = plan;
  return rest;
}

/** Load a plan the user can access. Missing access is reported as not found. */
export async function getPlanWithRole(planId, userId) {
  const plan = await getItem(planKey(planId));
  const role = roleOf(plan, userId);
  if (!role) throw new NotFoundError("Plan not found");
  return { plan, role };
}

// ── Plans ─────────────────────────────────────────────────────────────────────

/** The user's access items and the plans they point to (missing plans are skipped). */
async function plansForUser(userId) {
  const access = await queryAccessItems(userId);
  const plans = await batchGet([...new Set(access.map((a) => a.planId))].map(planKey));
  return { access, plans };
}

const summarize = (plan, role) => ({
  planId: plan.planId,
  name: plan.name,
  unit: plan.unit,
  timeZone: plan.timeZone,
  cadenceStart: plan.cadenceStart,
  sprintWeeks: plan.sprintWeeks,
  memberCount: plan.memberIds.length,
  ownerId: plan.ownerId,
  role,
  updatedAt: plan.updatedAt,
});

/** Plans the user owns, can edit, or can view. Roles come from the plan items. */
export async function listPlansForUser(userId) {
  const { plans } = await plansForUser(userId);
  const out = { owned: [], editable: [], readOnly: [] };
  for (const plan of plans) {
    const role = roleOf(plan, userId);
    if (role === "owner") out.owned.push(summarize(plan, role));
    else if (role === "edit") out.editable.push(summarize(plan, role));
    else if (role === "view") out.readOnly.push(summarize(plan, role));
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name));
  return { ...out, ownedCount: out.owned.length, maxOwned: MAX_OWNED_PLANS };
}

/**
 * Create a plan. `memberIds` are app users (given edit access); `guestNames`
 * are team members without an account, who appear as rows only.
 */
export async function createPlan(ownerId, cfg, memberIds, guestNames = []) {
  const planId = crypto.randomUUID();
  const now = nowUtcIso();
  const access = {};
  for (const id of memberIds) if (id !== ownerId) access[id] = "edit";
  const guests = Object.fromEntries(guestNames.map((name) => [crypto.randomUUID(), { name, createdAt: now }]));
  const plan = {
    ...planKey(planId),
    planId,
    ownerId,
    ...cfg,
    sprintNames: {},
    memberIds: [...memberIds, ...Object.keys(guests)],
    guests,
    access,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await transact([
      txPut(plan, { ConditionExpression: "attribute_not_exists(PK)" }),
      quotaChange(ownerId, 1),
      accessItem(planId, ownerId, "owner"),
      ...Object.keys(access).map((id) => accessItem(planId, id, "edit")),
    ]);
  } catch (e) {
    if (failedAt(e, 1)) throw new CapacityError(PLAN_LIMIT_MESSAGE);
    throw e;
  }
  return plan;
}

/** Drop custom Sprint names that no longer fall on a Sprint start. */
function pruneSprintNames(plan) {
  const len = sprintLengthDays(plan);
  const names = {};
  for (const [start, name] of Object.entries(plan.sprintNames || {})) {
    const d = diffDays(plan.cadenceStart, start);
    if (d >= 0 && d % len === 0) names[start] = name;
  }
  return names;
}

export async function updatePlanSettings(planId, userId, patch, expectedVersion) {
  return mutatePlan(planId, (plan) => {
    requireRole(roleOf(plan, userId), ["owner"]);
    if (plan.version !== expectedVersion) throw new ConflictError("The plan was changed by someone else");
    const next = { ...plan, ...patch };
    next.sprintNames = pruneSprintNames(next);
    return { plan: next };
  });
}

export async function patchSprintNames(planId, userId, patch) {
  return mutatePlan(planId, (plan) => {
    requireRole(roleOf(plan, userId), editRoles);
    const len = sprintLengthDays(plan);
    const names = { ...(plan.sprintNames || {}) };
    for (const [start, name] of Object.entries(patch)) {
      const d = diffDays(plan.cadenceStart, start);
      if (d < 0 || d % len !== 0) throw new CapacityError("That date is not the start of a Sprint");
      if (name === null) delete names[start];
      else names[start] = name;
    }
    if (Object.keys(names).length > MAX_SPRINT_NAMES) throw new CapacityError("Too many custom Sprint names");
    return { plan: { ...plan, sprintNames: names } };
  });
}

/** Delete a plan for everyone. The plan item goes first, which revokes access immediately. */
async function deletePlanItems(plan) {
  try {
    await transact([
      { Delete: { TableName: TABLE(), Key: planKey(plan.planId), ConditionExpression: "#v = :v", ExpressionAttributeNames: { "#v": "version" }, ExpressionAttributeValues: { ":v": plan.version } } },
      quotaChange(plan.ownerId, -1),
    ]);
  } catch (e) {
    if (failedAt(e, 0)) throw new ConflictError("The plan was changed by someone else");
    throw e;
  }
  const userIds = [...new Set([plan.ownerId, ...Object.keys(plan.access || {}), ...plan.memberIds.filter((id) => !plan.guests?.[id])])];
  await deleteKeys([
    ...userIds.map((id) => accessKey(plan.planId, id)),
    ...plan.memberIds.map((id) => availKey(plan.planId, id)),
  ]);
}

export async function deletePlan(planId, userId) {
  const { plan, role } = await getPlanWithRole(planId, userId);
  requireRole(role, ["owner"]);
  await deletePlanItems(plan);
}

// ── Team members ──────────────────────────────────────────────────────────────

/** Add a team row. Someone without access is given edit access so they can fill it in. */
export async function addMember(planId, actorId, memberId) {
  return mutatePlan(planId, (plan) => {
    requireRole(roleOf(plan, actorId), editRoles);
    if (plan.memberIds.includes(memberId)) throw new CapacityError("Already a team member");
    if (plan.memberIds.length >= MAX_MEMBERS) throw new CapacityError(`A plan can have at most ${MAX_MEMBERS} team members`);
    plan.memberIds.push(memberId);
    const items = [];
    if (!roleOf(plan, memberId)) {
      if (Object.keys(plan.access).length >= MAX_ACCESS) throw new CapacityError("This plan is shared with too many people");
      plan.access[memberId] = "edit";
      items.push(accessItem(planId, memberId, "edit"));
    }
    return { plan, items };
  });
}

/** Add a team row for someone without an account. They get no access to the plan. */
export async function addGuestMember(planId, actorId, name) {
  return mutatePlan(planId, (plan) => {
    requireRole(roleOf(plan, actorId), editRoles);
    if (plan.memberIds.length >= MAX_MEMBERS) throw new CapacityError(`A plan can have at most ${MAX_MEMBERS} team members`);
    const guestId = crypto.randomUUID();
    plan.guests = { ...(plan.guests || {}), [guestId]: { name, createdAt: nowUtcIso() } };
    plan.memberIds.push(guestId);
    return { plan };
  });
}

/** Rename a team member who doesn't have an account. */
export async function renameGuestMember(planId, actorId, guestId, name) {
  return mutatePlan(planId, (plan) => {
    requireRole(roleOf(plan, actorId), editRoles);
    if (!plan.guests?.[guestId]) throw new NotFoundError("Not a team member without an account");
    plan.guests[guestId] = { ...plan.guests[guestId], name };
    return { plan };
  });
}

/**
 * Link a team member without an account to a user account. The row keeps its
 * place and its availability moves to the account; someone without access is
 * given edit access, as when adding a member.
 */
export async function linkGuestMember(planId, actorId, guestId, userId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const guestAvail = await getItem(availKey(planId, guestId));
    // Conditions on the availability items catch edits made while linking.
    const availItems = guestAvail
      ? [
          {
            Delete: {
              TableName: TABLE(),
              Key: availKey(planId, guestId),
              ConditionExpression: "#v = :v",
              ExpressionAttributeNames: { "#v": "version" },
              ExpressionAttributeValues: { ":v": guestAvail.version },
            },
          },
          // `userId` isn't a team member (checked below, under the plan's version), so any
          // availability item they still have here is an orphan and is overwritten.
          txPut({ ...availKey(planId, userId), planId, memberId: userId, days: guestAvail.days || {}, version: 1, updatedAt: nowUtcIso() }),
        ]
      : [
          { Delete: { TableName: TABLE(), Key: availKey(planId, guestId), ConditionExpression: "attribute_not_exists(PK)" } },
          txDelete(availKey(planId, userId)),
        ];
    try {
      return await mutatePlan(planId, (plan) => {
        requireRole(roleOf(plan, actorId), editRoles);
        if (!plan.guests?.[guestId]) throw new NotFoundError("Not a team member without an account");
        if (plan.memberIds.includes(userId)) throw new CapacityError("That person is already a team member");
        plan.memberIds = plan.memberIds.map((id) => (id === guestId ? userId : id));
        delete plan.guests[guestId];
        const items = [...availItems];
        if (!roleOf(plan, userId)) {
          if (Object.keys(plan.access).length >= MAX_ACCESS) throw new CapacityError("This plan is shared with too many people");
          plan.access[userId] = "edit";
          items.push(accessItem(planId, userId, "edit"));
        }
        return { plan, items };
      });
    } catch (e) {
      if (!availItems.some((_, i) => failedAt(e, i + 1))) throw e;
    }
  }
  throw new ConflictError("Concurrent update");
}

/** Remove a team row and its availability. Access to the plan is unchanged. */
export async function removeMember(planId, actorId, memberId) {
  return mutatePlan(planId, (plan) => {
    requireRole(roleOf(plan, actorId), editRoles);
    if (!plan.memberIds.includes(memberId)) throw new NotFoundError("Not a team member");
    plan.memberIds = plan.memberIds.filter((id) => id !== memberId);
    const items = [txDelete(availKey(planId, memberId))];
    if (plan.guests?.[memberId]) delete plan.guests[memberId];
    else if (!roleOf(plan, memberId)) items.push(txDelete(accessKey(planId, memberId)));
    return { plan, items };
  });
}

// ── Sharing ───────────────────────────────────────────────────────────────────

export async function setAccess(planId, actorId, targetId, role) {
  return mutatePlan(planId, (plan) => {
    requireRole(roleOf(plan, actorId), editRoles);
    if (targetId === plan.ownerId) throw new ForbiddenError("The owner's access can't be changed");
    if (!plan.access[targetId] && Object.keys(plan.access).length >= MAX_ACCESS) {
      throw new CapacityError("This plan is shared with too many people");
    }
    plan.access[targetId] = role;
    return { plan, items: [accessItem(planId, targetId, role)] };
  });
}

export async function removeAccess(planId, actorId, targetId) {
  return mutatePlan(planId, (plan) => {
    requireRole(roleOf(plan, actorId), editRoles);
    if (targetId === plan.ownerId) throw new ForbiddenError("The owner's access can't be removed");
    if (!plan.access[targetId]) throw new NotFoundError("That person doesn't have access");
    delete plan.access[targetId];
    return { plan, items: [accessRemoved(plan, targetId)] };
  });
}

export async function leavePlan(planId, userId) {
  return mutatePlan(planId, (plan) => {
    const role = roleOf(plan, userId);
    if (!role) throw new NotFoundError("Plan not found");
    if (role === "owner") throw new CapacityError("Transfer ownership or delete the plan instead");
    delete plan.access[userId];
    return { plan, items: [accessRemoved(plan, userId)] };
  });
}

/**
 * Hand the plan to a user who has edit access. The previous owner keeps edit
 * access unless `retainPreviousOwner` is false (account deletion), in which
 * case their team row and availability are removed too.
 */
export async function transferOwnership(planId, fromId, toId, { retainPreviousOwner = true } = {}) {
  try {
    return await mutatePlan(planId, (plan) => {
      if (plan.ownerId !== fromId) throw new ForbiddenError("Only the owner can transfer the plan");
      if (plan.access[toId] !== "edit") throw new CapacityError("The new owner must have edit access");
      plan.ownerId = toId;
      delete plan.access[toId];
      if (retainPreviousOwner) plan.access[fromId] = "edit";
      else plan.memberIds = plan.memberIds.filter((id) => id !== fromId);
      plan.transferredAt = nowUtcIso();
      return {
        plan,
        items: [
          accessItem(planId, toId, "owner"),
          retainPreviousOwner ? accessItem(planId, fromId, "edit") : txDelete(accessKey(planId, fromId)),
          quotaChange(fromId, -1),
          quotaChange(toId, 1),
          ...(retainPreviousOwner ? [] : [txDelete(availKey(planId, fromId))]),
        ],
      };
    });
  } catch (e) {
    if (failedAt(e, 4)) throw new CapacityError(`The new owner already owns ${MAX_OWNED_PLANS} plans`);
    throw e;
  }
}

// ── Availability ──────────────────────────────────────────────────────────────

export async function getAvailability(planId, memberIds) {
  const items = await batchGet(memberIds.map((id) => availKey(planId, id)));
  const out = {};
  for (const item of items) out[item.memberId] = item.days || {};
  return out;
}

/** Merge changed days into a member's exceptions. Full availability (1) removes the entry. */
export async function patchAvailability(planId, actorId, input) {
  const { plan: initial, role } = await getPlanWithRole(planId, actorId);
  requireRole(role, editRoles);
  const { memberId, days } = normalizeAvailabilityPatch(input, initial);

  for (let attempt = 0; attempt < 3; attempt++) {
    // Re-read the plan each attempt and require it unchanged at commit time, so
    // a member removed or linked meanwhile can't get an orphaned availability item.
    const { plan, role: currentRole } = attempt === 0 ? { plan: initial, role } : await getPlanWithRole(planId, actorId);
    requireRole(currentRole, editRoles);
    if (!plan.memberIds.includes(memberId)) throw new CapacityError("Not a team member of this plan");

    const current = await getItem(availKey(planId, memberId));
    const merged = { ...(current?.days || {}) };
    for (const [date, value] of Object.entries(days)) {
      if (value === 1) delete merged[date];
      else merged[date] = value;
    }
    if (Object.keys(merged).length > MAX_OVERRIDES_PER_MEMBER) throw new CapacityError("Too many availability changes for this member");
    const version = (current?.version || 0) + 1;
    try {
      await transact([
        {
          ConditionCheck: {
            TableName: TABLE(),
            Key: planKey(planId),
            ConditionExpression: "#v = :v",
            ExpressionAttributeNames: { "#v": "version" },
            ExpressionAttributeValues: { ":v": plan.version },
          },
        },
        txPut(
          { ...availKey(planId, memberId), planId, memberId, days: merged, version, updatedAt: nowUtcIso() },
          current
            ? { ConditionExpression: "#v = :v", ExpressionAttributeNames: { "#v": "version" }, ExpressionAttributeValues: { ":v": current.version } }
            : { ConditionExpression: "attribute_not_exists(PK)" }
        ),
      ]);
      return { memberId, days: merged, version };
    } catch (e) {
      if (!failedAt(e, 0) && !failedAt(e, 1)) throw e;
    }
  }
  throw new ConflictError("Concurrent update");
}

// ── Account deletion ──────────────────────────────────────────────────────────

const editorsOf = (plan) => Object.entries(plan.access || {}).filter(([, r]) => r === "edit").map(([id]) => id);

/** { [userId]: number of plans they own }, from the quota items. */
async function ownedCounts(userIds) {
  const quotas = await batchGet(userIds.map(quotaKey));
  return Object.fromEntries(quotas.map((q) => [q.PK.slice("PLANQUOTA#".length), q.ownedCount || 0]));
}

/**
 * Owned plans split into those deleted automatically (nobody else can edit)
 * and those needing a transfer-or-delete decision, with eligible new owners.
 */
export async function getDeletionReview(userId) {
  const { plans } = await plansForUser(userId);
  const owned = plans.filter((p) => p.ownerId === userId);
  const counts = await ownedCounts([...new Set(owned.flatMap(editorsOf))]);

  const autoDelete = [];
  const needsDecision = [];
  for (const plan of owned) {
    const editors = editorsOf(plan);
    const summary = { planId: plan.planId, name: plan.name, sharedWith: Object.keys(plan.access || {}).length };
    if (editors.length === 0) autoDelete.push(summary);
    else needsDecision.push({ ...summary, candidates: editors.map((id) => ({ userId: id, atLimit: (counts[id] || 0) >= MAX_OWNED_PLANS })) });
  }
  return { autoDelete, needsDecision };
}

/**
 * Remove a user's capacity data. Owned plans with other editors need a
 * decision ({ action: "transfer", newOwnerId } | { action: "delete" }) unless
 * `force` is set (admin deletion), in which case they are deleted. Transfers run
 * before anything is deleted so a failure leaves the account intact.
 */
export async function deleteAllCapacityData(userId, decisions = {}, { force = false } = {}) {
  const { access, plans } = await plansForUser(userId);
  const owned = plans.filter((p) => p.ownerId === userId);
  const transfers = [];

  if (!force) {
    const missing = [];
    for (const plan of owned) {
      const editors = editorsOf(plan);
      if (editors.length === 0) continue;
      const decision = decisions[plan.planId];
      if (!decision) missing.push({ planId: plan.planId, name: plan.name });
      else if (decision.action === "transfer") {
        if (!editors.includes(decision.newOwnerId)) throw new CapacityError(`The new owner of "${plan.name}" must have edit access`);
        transfers.push({ plan, newOwnerId: decision.newOwnerId });
      }
    }
    if (missing.length) throw new DecisionRequiredError(missing);
  }

  // Check every new owner's quota up front: transfers are committed one at a
  // time, so a late failure would leave earlier plans already handed over.
  if (transfers.length) {
    const incoming = {};
    for (const { newOwnerId } of transfers) incoming[newOwnerId] = (incoming[newOwnerId] || 0) + 1;
    const counts = await ownedCounts(Object.keys(incoming));
    for (const [id, n] of Object.entries(incoming)) {
      if ((counts[id] || 0) + n > MAX_OWNED_PLANS) {
        const names = transfers.filter((t) => t.newOwnerId === id).map((t) => `"${t.plan.name}"`).join(", ");
        throw new CapacityError(`Can't transfer ${names}: each person can own at most ${MAX_OWNED_PLANS} plans`);
      }
    }
  }

  for (const { plan, newOwnerId } of transfers) {
    await transferOwnership(plan.planId, userId, newOwnerId, { retainPreviousOwner: false });
  }
  const transferredIds = new Set(transfers.map((t) => t.plan.planId));

  let plansDeleted = 0;
  for (const plan of owned) {
    if (transferredIds.has(plan.planId)) continue;
    const latest = await getItem(planKey(plan.planId));
    if (!latest) continue;
    await deletePlanItems(latest);
    plansDeleted++;
  }

  const livePlanIds = new Set(plans.map((p) => p.planId));
  for (const plan of plans) {
    if (plan.ownerId === userId || transferredIds.has(plan.planId)) continue;
    if (plan.access?.[userId] || plan.memberIds.includes(userId)) {
      try {
        await mutatePlan(plan.planId, (p) => {
          if (!p.access?.[userId] && !p.memberIds.includes(userId)) throw new NotFoundError("No access");
          delete p.access[userId];
          p.memberIds = p.memberIds.filter((id) => id !== userId);
          return { plan: p, items: [txDelete(accessKey(p.planId, userId)), txDelete(availKey(p.planId, userId))] };
        });
      } catch (e) {
        // The plan was deleted, or the access and team row removed, meanwhile; clear any stale access item below.
        if (!(e instanceof NotFoundError)) throw e;
        livePlanIds.delete(plan.planId);
      }
    }
  }
  // Stale access items whose plan no longer exists.
  await deleteKeys(access.filter((a) => !livePlanIds.has(a.planId)).map((a) => accessKey(a.planId, userId)));
  await docClient.send(new DeleteCommand({ TableName: TABLE(), Key: quotaKey(userId) }));

  return { plansDeleted, plansTransferred: transfers.length };
}

