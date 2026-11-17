/**
 * Opt-in integration test against a real DynamoDB (Local). It checks that the
 * condition expressions, transactions and GSI queries are accepted by DynamoDB
 * itself, which the in-memory fake can't prove.
 *
 *   docker compose up -d dynamodb-local && node scripts/init-db.mjs
 *   DYNAMODB_INTEGRATION=1 npx jest __tests__/integration
 *
 * Only items belonging to random ids created here are written and removed.
 */
const enabled = process.env.DYNAMODB_INTEGRATION === "1";
const run = enabled ? describe : describe.skip;

if (enabled) {
  process.env.DYNAMODB_ENDPOINT ||= "http://localhost:8000";
  process.env.AWS_ACCESS_KEY_ID ||= "fakeMyKeyId";
  process.env.AWS_SECRET_ACCESS_KEY ||= "fakeSecretAccessKey";
}

const crypto = require("crypto");

run("capacity store against DynamoDB Local", () => {
  const store = require("@/lib/capacity/store");
  const { docClient, TableNames } = require("@/lib/dynamodb");
  const { ScanCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

  const OWNER = crypto.randomUUID();
  const EDITOR = crypto.randomUUID();
  const VIEWER = crypto.randomUUID();
  const ids = [OWNER, EDITOR, VIEWER];
  const planIds = new Set();
  const cfg = {
    name: "Integration",
    timeZone: "UTC",
    unit: "hours",
    hoursPerDay: 7.5,
    pointsPerDay: 2,
    workingDays: [1, 2, 3, 4, 5],
    cadenceStart: "2026-10-05",
    sprintWeeks: 2,
  };
  const create = async (owner, members) => {
    const plan = await store.createPlan(owner, cfg, members);
    planIds.add(plan.planId);
    return plan;
  };

  afterAll(async () => {
    const res = await docClient.send(new ScanCommand({ TableName: TableNames.CapacityPlans }));
    const mine = (res.Items || []).filter((i) => ids.some((id) => i.PK.includes(id)) || planIds.has(i.planId));
    await Promise.all(mine.map((i) => docClient.send(new DeleteCommand({ TableName: TableNames.CapacityPlans, Key: { PK: i.PK } }))));
  });

  it("runs the full plan lifecycle", async () => {
    const plan = await create(OWNER, [OWNER, EDITOR]);
    await store.setAccess(plan.planId, EDITOR, VIEWER, "view");

    const listing = await store.listPlansForUser(VIEWER);
    expect(listing.readOnly.map((p) => p.planId)).toContain(plan.planId);

    await store.patchAvailability(plan.planId, EDITOR, { memberId: OWNER, days: { "2026-10-05": 0.5, "2026-10-06": 0 } });
    const merged = await store.patchAvailability(plan.planId, OWNER, { memberId: OWNER, days: { "2026-10-06": 1 } });
    expect(merged.days).toEqual({ "2026-10-05": 0.5 });

    const withGuest = await store.addGuestMember(plan.planId, EDITOR, "Casey Contractor");
    const guestId = withGuest.memberIds.at(-1);
    await store.patchAvailability(plan.planId, EDITOR, { memberId: guestId, days: { "2026-10-05": 0.25 } });
    await store.renameGuestMember(plan.planId, OWNER, guestId, "Casey C.");
    expect((await store.getAvailability(plan.planId, [guestId]))[guestId]).toEqual({ "2026-10-05": 0.25 });
    const linked = await store.linkGuestMember(plan.planId, OWNER, guestId, VIEWER);
    expect(linked.memberIds.at(-1)).toBe(VIEWER);
    expect((await store.getAvailability(plan.planId, [VIEWER]))[VIEWER]).toEqual({ "2026-10-05": 0.25 });
    const unlinked = await store.addGuestMember(plan.planId, OWNER, "No availability yet");
    await store.linkGuestMember(plan.planId, OWNER, unlinked.memberIds.at(-1), crypto.randomUUID());

    const named = await store.patchSprintNames(plan.planId, EDITOR, { "2026-10-19": "Hardening" });
    await expect(store.updatePlanSettings(plan.planId, OWNER, { sprintWeeks: 3 }, named.version - 1)).rejects.toBeInstanceOf(store.ConflictError);
    const updated = await store.updatePlanSettings(plan.planId, OWNER, { unit: "points" }, named.version);
    expect(updated.unit).toBe("points");

    const moved = await store.transferOwnership(plan.planId, OWNER, EDITOR);
    expect(moved.ownerId).toBe(EDITOR);
    expect((await store.getPlanWithRole(plan.planId, OWNER)).role).toBe("edit");
    const back = await store.transferOwnership(plan.planId, EDITOR, OWNER);
    expect(back.ownerId).toBe(OWNER);
  });

  it("enforces the 10 plan quota atomically", async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => create(VIEWER, [])));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(results.filter((r) => r.status === "rejected").every((r) => /at most 10/.test(r.reason.message))).toBe(true);
  });

  it("handles account deletion with transfer and auto-delete", async () => {
    const shared = await create(OWNER, [OWNER, EDITOR]);
    const solo = await create(OWNER, [OWNER]);
    const review = await store.getDeletionReview(OWNER);
    expect(review.needsDecision.map((p) => p.planId)).toContain(shared.planId);
    expect(review.autoDelete.map((p) => p.planId)).toContain(solo.planId);

    await expect(store.deleteAllCapacityData(OWNER, {})).rejects.toBeInstanceOf(store.DecisionRequiredError);

    const decisions = Object.fromEntries(review.needsDecision.map((p) => [p.planId, { action: "transfer", newOwnerId: EDITOR }]));
    const result = await store.deleteAllCapacityData(OWNER, decisions);
    expect(result.plansTransferred).toBe(review.needsDecision.length);
    expect((await store.getPlanWithRole(shared.planId, EDITOR)).role).toBe("owner");
    await expect(store.getPlanWithRole(solo.planId, EDITOR)).rejects.toBeInstanceOf(store.NotFoundError);
    expect((await store.listPlansForUser(OWNER)).owned).toEqual([]);
  });
});
