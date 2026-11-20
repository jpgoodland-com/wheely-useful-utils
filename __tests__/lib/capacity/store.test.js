jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return {
    docClient: createFakeDynamo(),
    TableNames: { Users: "WheelApp_Users", CapacityPlans: "WheelApp_CapacityPlans" },
  };
});

const { docClient } = require("@/lib/dynamodb");
const store = require("@/lib/capacity/store");
const { CapacityError } = require("@/lib/capacity/validate");

const T = "WheelApp_CapacityPlans";
const OWNER = "00000000-0000-4000-8000-000000000001";
const EDITOR = "00000000-0000-4000-8000-000000000002";
const VIEWER = "00000000-0000-4000-8000-000000000003";
const STRANGER = "00000000-0000-4000-8000-000000000004";

const cfg = {
  name: "Team A",
  timeZone: "Australia/Sydney",
  unit: "points",
  hoursPerDay: 8,
  pointsPerDay: 2,
  workingDays: [1, 2, 3, 4, 5],
  cadenceStart: "2026-10-05",
  sprintWeeks: 2,
};

async function seedPlan({ owner = OWNER, members = [owner, EDITOR], viewers = [VIEWER], name = "Team A" } = {}) {
  const plan = await store.createPlan(owner, { ...cfg, name }, members);
  let latest = plan;
  for (const v of viewers) latest = await store.setAccess(plan.planId, owner, v, "view");
  return latest;
}

beforeEach(() => docClient.reset());

describe("createPlan / listPlansForUser", () => {
  it("writes the plan, access index and quota together", async () => {
    const plan = await seedPlan();
    expect(docClient.get(T, `PLANACCESS#${plan.planId}#${OWNER}`)).toMatchObject({ userId: OWNER, role: "owner" });
    expect(docClient.get(T, `PLANACCESS#${plan.planId}#${EDITOR}`)).toMatchObject({ role: "edit" });
    expect(docClient.get(T, `PLANQUOTA#${OWNER}`).ownedCount).toBe(1);
    expect(plan.access).toEqual({ [EDITOR]: "edit", [VIEWER]: "view" });
    // Quota and availability items never carry userId, so they stay out of the GSI.
    expect(docClient.get(T, `PLANQUOTA#${OWNER}`).userId).toBeUndefined();
  });

  it("groups plans by the caller's role", async () => {
    const plan = await seedPlan();
    expect((await store.listPlansForUser(OWNER)).owned.map((p) => p.planId)).toEqual([plan.planId]);
    expect((await store.listPlansForUser(EDITOR)).editable).toHaveLength(1);
    expect((await store.listPlansForUser(VIEWER)).readOnly).toHaveLength(1);
    expect(await store.listPlansForUser(STRANGER)).toMatchObject({ owned: [], editable: [], readOnly: [], ownedCount: 0 });
  });

  it("allows at most 10 owned plans", async () => {
    for (let i = 0; i < 10; i++) await store.createPlan(OWNER, cfg, []);
    await expect(store.createPlan(OWNER, cfg, [])).rejects.toThrow("You can own at most 10 plans");
    expect(docClient.items(T).filter((i) => i.PK.startsWith("PLAN#"))).toHaveLength(10);
  });
});

describe("roles", () => {
  it("hides plans from strangers as not found", async () => {
    const plan = await seedPlan();
    await expect(store.getPlanWithRole(plan.planId, STRANGER)).rejects.toBeInstanceOf(store.NotFoundError);
    expect((await store.getPlanWithRole(plan.planId, VIEWER)).role).toBe("view");
  });

  it("lets editors manage members and sharing but not the owner's access", async () => {
    const plan = await seedPlan();
    await store.addMember(plan.planId, EDITOR, STRANGER);
    let latest = await store.setAccess(plan.planId, EDITOR, STRANGER, "view");
    expect(latest.access[STRANGER]).toBe("view");
    expect(latest.memberIds).toContain(STRANGER);
    await expect(store.setAccess(plan.planId, EDITOR, OWNER, "view")).rejects.toBeInstanceOf(store.ForbiddenError);
    await expect(store.removeAccess(plan.planId, EDITOR, OWNER)).rejects.toBeInstanceOf(store.ForbiddenError);
    latest = await store.removeAccess(plan.planId, EDITOR, STRANGER);
    expect(latest.access[STRANGER]).toBeUndefined();
    // Still a team member, so the index item stays (role "member") for account deletion.
    expect(docClient.get(T, `PLANACCESS#${plan.planId}#${STRANGER}`).role).toBe("member");
  });

  it("stops read-only users and editors from owner-only actions", async () => {
    const plan = await seedPlan();
    await expect(store.setAccess(plan.planId, VIEWER, STRANGER, "view")).rejects.toBeInstanceOf(store.ForbiddenError);
    await expect(store.addMember(plan.planId, VIEWER, STRANGER)).rejects.toBeInstanceOf(store.ForbiddenError);
    await expect(store.updatePlanSettings(plan.planId, EDITOR, { name: "X" }, plan.version)).rejects.toBeInstanceOf(store.ForbiddenError);
    await expect(store.deletePlan(plan.planId, EDITOR)).rejects.toBeInstanceOf(store.ForbiddenError);
  });

  it("grants edit access to new team members who had none", async () => {
    const plan = await store.createPlan(OWNER, cfg, []);
    const latest = await store.addMember(plan.planId, OWNER, STRANGER);
    expect(latest.access[STRANGER]).toBe("edit");
    const kept = await store.addMember((await store.setAccess(plan.planId, OWNER, VIEWER, "view")).planId, OWNER, VIEWER);
    expect(kept.access[VIEWER]).toBe("view");
  });

  it("lets non-owners leave but not the owner", async () => {
    const plan = await seedPlan();
    await store.leavePlan(plan.planId, VIEWER);
    await expect(store.getPlanWithRole(plan.planId, VIEWER)).rejects.toBeInstanceOf(store.NotFoundError);
    await expect(store.leavePlan(plan.planId, OWNER)).rejects.toBeInstanceOf(CapacityError);
  });
});

describe("settings and Sprint names", () => {
  it("rejects stale versions and prunes Sprint names that no longer line up", async () => {
    const plan = await seedPlan();
    const named = await store.patchSprintNames(plan.planId, EDITOR, { "2026-10-19": "Hardening", "2026-11-02": "Release" });
    await expect(store.updatePlanSettings(plan.planId, OWNER, { sprintWeeks: 3 }, plan.version)).rejects.toBeInstanceOf(store.ConflictError);
    const updated = await store.updatePlanSettings(plan.planId, OWNER, { sprintWeeks: 4 }, named.version);
    expect(updated.sprintNames).toEqual({ "2026-11-02": "Release" });
  });

  it("only renames real Sprint starts", async () => {
    const plan = await seedPlan();
    await expect(store.patchSprintNames(plan.planId, OWNER, { "2026-10-20": "Nope" })).rejects.toBeInstanceOf(CapacityError);
    const cleared = await store.patchSprintNames(plan.planId, OWNER, { "2026-10-05": null });
    expect(cleared.sprintNames).toEqual({});
  });

  it("retries when someone else updates the plan at the same time", async () => {
    const plan = await seedPlan();
    let raced = false;
    docClient.beforeSend = (name) => {
      if (name === "TransactWriteCommand" && !raced) {
        raced = true;
        const item = docClient.get(T, `PLAN#${plan.planId}`);
        docClient.put(T, { ...item, version: item.version + 1 });
      }
    };
    const updated = await store.patchSprintNames(plan.planId, OWNER, { "2026-10-05": "Kickoff" });
    expect(updated.sprintNames).toEqual({ "2026-10-05": "Kickoff" });
    expect(updated.version).toBe(plan.version + 2);
  });
});

describe("availability", () => {
  it("stores only exceptions and removes entries set back to full", async () => {
    const plan = await seedPlan();
    await store.patchAvailability(plan.planId, EDITOR, { memberId: OWNER, days: { "2026-10-05": 0.5, "2026-10-06": 0 } });
    const res = await store.patchAvailability(plan.planId, OWNER, { memberId: OWNER, days: { "2026-10-06": 1 } });
    expect(res.days).toEqual({ "2026-10-05": 0.5 });
    expect(await store.getAvailability(plan.planId, [OWNER, EDITOR])).toEqual({ [OWNER]: { "2026-10-05": 0.5 } });
    expect(docClient.get(T, `PLANAVAIL#${plan.planId}#${OWNER}`).userId).toBeUndefined();
  });

  it("rejects read-only users and people who aren't team members", async () => {
    const plan = await seedPlan();
    await expect(store.patchAvailability(plan.planId, VIEWER, { memberId: OWNER, days: { "2026-10-05": 0.5 } })).rejects.toBeInstanceOf(store.ForbiddenError);
    await expect(store.patchAvailability(plan.planId, OWNER, { memberId: VIEWER, days: { "2026-10-05": 0.5 } })).rejects.toBeInstanceOf(CapacityError);
  });

  it("doesn't recreate availability for a member removed while saving", async () => {
    const plan = await seedPlan();
    let raced = false;
    docClient.beforeSend = async (name) => {
      if (name === "TransactWriteCommand" && !raced) {
        raced = true;
        docClient.beforeSend = null;
        await store.removeMember(plan.planId, OWNER, EDITOR);
      }
    };
    await expect(store.patchAvailability(plan.planId, OWNER, { memberId: EDITOR, days: { "2026-10-05": 0 } })).rejects.toBeInstanceOf(CapacityError);
    expect(docClient.get(T, `PLANAVAIL#${plan.planId}#${EDITOR}`)).toBeUndefined();
  });

  it("removing a team member deletes their availability but keeps their access", async () => {
    const plan = await seedPlan();
    await store.patchAvailability(plan.planId, OWNER, { memberId: EDITOR, days: { "2026-10-05": 0 } });
    const latest = await store.removeMember(plan.planId, OWNER, EDITOR);
    expect(latest.memberIds).toEqual([OWNER]);
    expect(latest.access[EDITOR]).toBe("edit");
    expect(docClient.get(T, `PLANAVAIL#${plan.planId}#${EDITOR}`)).toBeUndefined();
  });

  it("removing a team member with no access also removes their index item", async () => {
    const plan = await seedPlan();
    await store.leavePlan(plan.planId, EDITOR);
    expect(docClient.get(T, `PLANACCESS#${plan.planId}#${EDITOR}`).role).toBe("member");
    await store.removeMember(plan.planId, OWNER, EDITOR);
    expect(docClient.get(T, `PLANACCESS#${plan.planId}#${EDITOR}`)).toBeUndefined();
  });
});

describe("team members without an account", () => {
  it("adds them as rows only, with no access", async () => {
    const plan = await store.createPlan(OWNER, cfg, [OWNER], ["Casey Contractor"]);
    const [guestId] = Object.keys(plan.guests);
    expect(plan.memberIds).toEqual([OWNER, guestId]);
    expect(plan.guests[guestId].name).toBe("Casey Contractor");
    expect(plan.access).toEqual({});
    expect(docClient.get(T, `PLANACCESS#${plan.planId}#${guestId}`)).toBeUndefined();
    await expect(store.getPlanWithRole(plan.planId, guestId)).rejects.toBeInstanceOf(store.NotFoundError);
  });

  it("lets editors add, rename, fill in and remove them", async () => {
    const plan = await seedPlan();
    let latest = await store.addGuestMember(plan.planId, EDITOR, "Pat Temp");
    const guestId = latest.memberIds.at(-1);
    latest = await store.renameGuestMember(plan.planId, EDITOR, guestId, "Pat Temporary");
    expect(latest.guests[guestId].name).toBe("Pat Temporary");

    const res = await store.patchAvailability(plan.planId, EDITOR, { memberId: guestId, days: { "2026-10-05": 0 } });
    expect(res.days).toEqual({ "2026-10-05": 0 });

    latest = await store.removeMember(plan.planId, OWNER, guestId);
    expect(latest.guests).toEqual({});
    expect(latest.memberIds).not.toContain(guestId);
    expect(docClient.get(T, `PLANAVAIL#${plan.planId}#${guestId}`)).toBeUndefined();
  });

  it("stops read-only users adding them, and renaming people who have accounts", async () => {
    const plan = await seedPlan();
    await expect(store.addGuestMember(plan.planId, VIEWER, "X")).rejects.toBeInstanceOf(store.ForbiddenError);
    await expect(store.renameGuestMember(plan.planId, OWNER, EDITOR, "X")).rejects.toBeInstanceOf(store.NotFoundError);
  });

  it("links them to an account, keeping their row position and availability", async () => {
    const plan = await store.createPlan(OWNER, cfg, [OWNER], ["Casey"]);
    const guestId = plan.memberIds[1];
    await store.addMember(plan.planId, OWNER, EDITOR);
    await store.patchAvailability(plan.planId, OWNER, { memberId: guestId, days: { "2026-10-05": 0.5 } });

    const linked = await store.linkGuestMember(plan.planId, OWNER, guestId, STRANGER);
    expect(linked.memberIds).toEqual([OWNER, STRANGER, EDITOR]);
    expect(linked.guests).toEqual({});
    expect(linked.access[STRANGER]).toBe("edit");
    expect(docClient.get(T, `PLANACCESS#${plan.planId}#${STRANGER}`).role).toBe("edit");
    expect(docClient.get(T, `PLANAVAIL#${plan.planId}#${guestId}`)).toBeUndefined();
    expect(await store.getAvailability(plan.planId, linked.memberIds)).toEqual({ [STRANGER]: { "2026-10-05": 0.5 } });
  });

  it("replaces an orphaned availability item left for the account being linked", async () => {
    for (const guestDays of [{ "2026-10-05": 0.5 }, null]) {
      const plan = await store.createPlan(OWNER, cfg, [OWNER], ["Casey"]);
      const guestId = plan.memberIds[1];
      if (guestDays) await store.patchAvailability(plan.planId, OWNER, { memberId: guestId, days: guestDays });
      docClient.put(T, { PK: `PLANAVAIL#${plan.planId}#${STRANGER}`, planId: plan.planId, memberId: STRANGER, days: { "2026-10-06": 0 }, version: 4 });

      const linked = await store.linkGuestMember(plan.planId, OWNER, guestId, STRANGER);
      expect(await store.getAvailability(plan.planId, linked.memberIds)).toEqual(guestDays ? { [STRANGER]: guestDays } : {});
    }
  });

  it("keeps existing access when linking, and refuses existing members or real accounts", async () => {
    const plan = await seedPlan();
    const withGuest = await store.addGuestMember(plan.planId, OWNER, "Vic's placeholder");
    const guestId = withGuest.memberIds.at(-1);
    await expect(store.linkGuestMember(plan.planId, OWNER, guestId, EDITOR)).rejects.toThrow("already a team member");
    await expect(store.linkGuestMember(plan.planId, OWNER, EDITOR, STRANGER)).rejects.toBeInstanceOf(store.NotFoundError);
    await expect(store.linkGuestMember(plan.planId, VIEWER, guestId, STRANGER)).rejects.toBeInstanceOf(store.ForbiddenError);
    const linked = await store.linkGuestMember(plan.planId, EDITOR, guestId, VIEWER);
    expect(linked.access[VIEWER]).toBe("view");
  });

  it("retries when the person's availability changes while linking", async () => {
    const plan = await store.createPlan(OWNER, cfg, [OWNER], ["Casey"]);
    const guestId = plan.memberIds[1];
    await store.patchAvailability(plan.planId, OWNER, { memberId: guestId, days: { "2026-10-05": 0.5 } });
    let raced = false;
    docClient.beforeSend = (name) => {
      if (name === "TransactWriteCommand" && !raced) {
        raced = true;
        const item = docClient.get(T, `PLANAVAIL#${plan.planId}#${guestId}`);
        docClient.put(T, { ...item, days: { "2026-10-05": 0.5, "2026-10-06": 0 }, version: item.version + 1 });
      }
    };
    await store.linkGuestMember(plan.planId, OWNER, guestId, EDITOR);
    expect((await store.getAvailability(plan.planId, [EDITOR]))[EDITOR]).toEqual({ "2026-10-05": 0.5, "2026-10-06": 0 });
  });

  it("counts them toward the team member limit", async () => {
    const plan = await store.createPlan(OWNER, cfg, [], Array.from({ length: 50 }, (_, i) => `Person ${i}`));
    await expect(store.addGuestMember(plan.planId, OWNER, "One too many")).rejects.toThrow("at most 50");
  });
});

describe("transfer and delete", () => {
  it("transfers to an editor, keeping the old owner as an editor", async () => {
    const plan = await seedPlan();
    await expect(store.transferOwnership(plan.planId, OWNER, VIEWER)).rejects.toThrow("must have edit access");
    const moved = await store.transferOwnership(plan.planId, OWNER, EDITOR);
    expect(moved.ownerId).toBe(EDITOR);
    expect(moved.access).toEqual({ [OWNER]: "edit", [VIEWER]: "view" });
    expect(moved.transferredAt).toMatch(/Z$/);
    expect(docClient.get(T, `PLANACCESS#${plan.planId}#${EDITOR}`).role).toBe("owner");
    expect(docClient.get(T, `PLANQUOTA#${OWNER}`).ownedCount).toBe(0);
    expect(docClient.get(T, `PLANQUOTA#${EDITOR}`).ownedCount).toBe(1);
  });

  it("blocks a transfer to someone who already owns 10 plans", async () => {
    const plan = await seedPlan();
    for (let i = 0; i < 10; i++) await store.createPlan(EDITOR, cfg, []);
    await expect(store.transferOwnership(plan.planId, OWNER, EDITOR)).rejects.toThrow("already owns 10 plans");
    expect(docClient.get(T, `PLAN#${plan.planId}`).ownerId).toBe(OWNER);
  });

  it("deletes everything for a plan and frees the quota", async () => {
    const plan = await seedPlan();
    await store.patchAvailability(plan.planId, OWNER, { memberId: EDITOR, days: { "2026-10-05": 0 } });
    await store.deletePlan(plan.planId, OWNER);
    expect(docClient.items(T).filter((i) => i.PK.includes(plan.planId))).toEqual([]);
    expect(docClient.get(T, `PLANQUOTA#${OWNER}`).ownedCount).toBe(0);
  });
});

describe("account deletion", () => {
  it("classifies owned plans by whether anyone else can edit them", async () => {
    const shared = await seedPlan({ name: "Shared" });
    const readOnly = await seedPlan({ members: [OWNER], name: "Read only" });
    const review = await store.getDeletionReview(OWNER);
    expect(review.autoDelete.map((p) => p.planId)).toEqual([readOnly.planId]);
    expect(review.needsDecision).toEqual([
      { planId: shared.planId, name: "Shared", sharedWith: 2, candidates: [{ userId: EDITOR, atLimit: false }] },
    ]);
  });

  it("refuses to delete anything until every editable plan has a decision", async () => {
    const shared = await seedPlan();
    const before = docClient.items(T);
    await expect(store.deleteAllCapacityData(OWNER, {})).rejects.toBeInstanceOf(store.DecisionRequiredError);
    expect(docClient.items(T)).toEqual(before);
    await expect(store.deleteAllCapacityData(OWNER, { [shared.planId]: { action: "transfer", newOwnerId: VIEWER } })).rejects.toThrow("must have edit access");
    expect(docClient.items(T)).toEqual(before);
  });

  it("transfers chosen plans and deletes the rest", async () => {
    const kept = await seedPlan({ name: "Kept" });
    const dropped = await seedPlan({ name: "Dropped" });
    const readOnly = await seedPlan({ members: [OWNER], name: "Read only" });
    const other = await seedPlan({ owner: EDITOR, members: [EDITOR, OWNER], viewers: [] });
    await store.setAccess(other.planId, EDITOR, OWNER, "edit");
    for (const p of [kept, other]) await store.patchAvailability(p.planId, OWNER, { memberId: OWNER, days: { "2026-10-05": 0 } });

    const result = await store.deleteAllCapacityData(OWNER, {
      [kept.planId]: { action: "transfer", newOwnerId: EDITOR },
      [dropped.planId]: { action: "delete" },
    });
    expect(result).toEqual({ plansDeleted: 2, plansTransferred: 1 });

    const keptNow = docClient.get(T, `PLAN#${kept.planId}`);
    expect(keptNow.ownerId).toBe(EDITOR);
    expect(keptNow.access).toEqual({ [VIEWER]: "view" });
    expect(docClient.get(T, `PLAN#${dropped.planId}`)).toBeUndefined();
    expect(docClient.get(T, `PLAN#${readOnly.planId}`)).toBeUndefined();
    expect(docClient.get(T, `PLAN#${other.planId}`).access[OWNER]).toBeUndefined();
    expect(keptNow.memberIds).toEqual([EDITOR]);
    expect(docClient.get(T, `PLAN#${other.planId}`).memberIds).toEqual([EDITOR]);
    expect(docClient.items(T).filter((i) => i.PK.includes(OWNER) || i.userId === OWNER)).toEqual([]);
    expect(docClient.get(T, `PLANQUOTA#${OWNER}`)).toBeUndefined();
    expect((await store.listPlansForUser(VIEWER)).readOnly.map((p) => p.planId)).toEqual([kept.planId]);
  });

  it("checks every new owner's quota before transferring anything", async () => {
    const a = await seedPlan({ name: "A" });
    const b = await seedPlan({ name: "B" });
    for (let i = 0; i < 9; i++) await seedPlan({ owner: EDITOR, members: [EDITOR], viewers: [], name: `E${i}` });
    const before = docClient.items(T);
    await expect(
      store.deleteAllCapacityData(OWNER, {
        [a.planId]: { action: "transfer", newOwnerId: EDITOR },
        [b.planId]: { action: "transfer", newOwnerId: EDITOR },
      })
    ).rejects.toBeInstanceOf(CapacityError);
    expect(docClient.items(T)).toEqual(before);
  });

  it("removes the team row and availability of a member whose access was removed", async () => {
    const plan = await seedPlan();
    await store.patchAvailability(plan.planId, OWNER, { memberId: EDITOR, days: { "2026-10-05": 0 } });
    await store.removeAccess(plan.planId, OWNER, EDITOR);
    expect(docClient.get(T, `PLANACCESS#${plan.planId}#${EDITOR}`).role).toBe("member");
    expect((await store.listPlansForUser(EDITOR)).editable).toEqual([]);

    await store.deleteAllCapacityData(EDITOR);
    expect(docClient.get(T, `PLAN#${plan.planId}`).memberIds).toEqual([OWNER]);
    expect(docClient.items(T).filter((i) => i.PK.includes(EDITOR) || i.userId === EDITOR)).toEqual([]);
  });

  it("force-deletes owned plans for admin deletion", async () => {
    const shared = await seedPlan();
    await store.deleteAllCapacityData(OWNER, {}, { force: true });
    expect(docClient.get(T, `PLAN#${shared.planId}`)).toBeUndefined();
  });
});
