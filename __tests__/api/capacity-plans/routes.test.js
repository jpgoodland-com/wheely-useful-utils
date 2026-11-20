jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return {
    docClient: createFakeDynamo(),
    TableNames: { Users: "WheelApp_Users", CapacityPlans: "WheelApp_CapacityPlans" },
  };
});
jest.mock("@/lib/session", () => ({ getSession: jest.fn() }));

const { docClient } = require("@/lib/dynamodb");
const { getSession } = require("@/lib/session");
const list = require("@/app/api/capacity-plans/route");
const one = require("@/app/api/capacity-plans/[planId]/route");
const availability = require("@/app/api/capacity-plans/[planId]/availability/route");
const sprintNames = require("@/app/api/capacity-plans/[planId]/sprint-names/route");
const members = require("@/app/api/capacity-plans/[planId]/members/route");
const memberOne = require("@/app/api/capacity-plans/[planId]/members/[userId]/route");
const memberLink = require("@/app/api/capacity-plans/[planId]/members/[userId]/link/route");
const access = require("@/app/api/capacity-plans/[planId]/access/route");
const accessOne = require("@/app/api/capacity-plans/[planId]/access/[userId]/route");
const transfer = require("@/app/api/capacity-plans/[planId]/transfer/route");
const leave = require("@/app/api/capacity-plans/[planId]/leave/route");
const exporter = require("@/app/api/capacity-plans/[planId]/export/route");
const aggregate = require("@/app/api/capacity-plans/aggregate/route");
const review = require("@/app/api/capacity-plans/deletion-review/route");

const OWNER = "00000000-0000-4000-8000-000000000001";
const EDITOR = "00000000-0000-4000-8000-000000000002";
const VIEWER = "00000000-0000-4000-8000-000000000003";
const STRANGER = "00000000-0000-4000-8000-000000000004";
const MISSING = "00000000-0000-4000-8000-0000000000ff";

const USERS = [
  [OWNER, "olive", "Olive", "Owner"],
  [EDITOR, "ed", "Ed", "Editor"],
  [VIEWER, "vic", "Vic", "Viewer"],
  [STRANGER, "sam", "Sam", "Stranger"],
];

const settings = {
  name: "Team A",
  timeZone: "Australia/Sydney",
  unit: "points",
  pointsPerDay: 2,
  cadenceStart: "2026-10-05",
  sprintWeeks: 2,
};

const as = (userId) => getSession.mockResolvedValue(userId ? { userId } : null);
const params = (p) => ({ params: Promise.resolve(p) });
const req = (method, body, url = "http://localhost/api/capacity-plans") =>
  new Request(url, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });

async function createPlan(body = {}) {
  as(OWNER);
  const res = await list.POST(req("POST", { ...settings, memberIds: [OWNER, EDITOR], ...body }));
  const data = await res.json();
  as(OWNER);
  await access.PUT(req("PUT", { userId: VIEWER, role: "view" }), params({ planId: data.plan.planId }));
  return data.plan.planId;
}

beforeEach(() => {
  docClient.reset();
  for (const [userId, username, firstName, lastName] of USERS) {
    docClient.put("WheelApp_Users", { PK: `USER#${userId}`, userId, username, firstName, lastName, email: `${username}@example.com`, EmailOrUsername: `${username}@example.com` });
  }
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("authentication and validation", () => {
  it("returns 401 without a session", async () => {
    as(null);
    expect((await list.GET()).status).toBe(401);
    expect((await one.GET(req("GET"), params({ planId: MISSING }))).status).toBe(401);
  });

  it("returns 400 for invalid settings and 413 for oversized bodies", async () => {
    as(OWNER);
    expect((await list.POST(req("POST", { ...settings, timeZone: "Nowhere/Land" }))).status).toBe(400);
    expect((await list.POST(req("POST", { ...settings, memberIds: [MISSING] }))).status).toBe(400);
    expect((await list.POST(req("POST", { ...settings, name: "x".repeat(20_000) }))).status).toBe(413);
  });

  it("treats malformed and inaccessible plan ids as not found", async () => {
    const planId = await createPlan();
    as(STRANGER);
    expect((await one.GET(req("GET"), params({ planId }))).status).toBe(404);
    expect((await one.GET(req("GET"), params({ planId: "../etc" }))).status).toBe(404);
  });
});

describe("create, read and list", () => {
  it("creates a plan and returns the full view", async () => {
    as(OWNER);
    const res = await list.POST(req("POST", { ...settings, memberIds: [OWNER, EDITOR] }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.role).toBe("owner");
    expect(data.members.map((m) => m.fullName)).toEqual(["Olive Owner", "Ed Editor"]);
    expect(data.access).toEqual([
      expect.objectContaining({ userId: OWNER, role: "owner", email: "olive@example.com" }),
      expect.objectContaining({ userId: EDITOR, role: "edit" }),
    ]);
    expect(data.plan.PK).toBeUndefined();
  });

  it("hides email addresses from read-only users", async () => {
    const planId = await createPlan();
    as(VIEWER);
    const data = await (await one.GET(req("GET"), params({ planId }))).json();
    expect(data.role).toBe("view");
    expect(data.access.every((p) => p.email === undefined)).toBe(true);
  });

  it("enforces the 10 plan limit", async () => {
    as(OWNER);
    for (let i = 0; i < 10; i++) expect((await list.POST(req("POST", settings))).status).toBe(201);
    const res = await list.POST(req("POST", settings));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at most 10/);
    const listing = await (await list.GET()).json();
    expect(listing.ownedCount).toBe(10);
  });
});

describe("role matrix", () => {
  let planId;
  beforeEach(async () => {
    planId = await createPlan();
  });

  it("only the owner changes core settings, transfers or deletes", async () => {
    as(EDITOR);
    expect((await one.PATCH(req("PATCH", { expectedVersion: 3, settings: { name: "B" } }), params({ planId }))).status).toBe(403);
    expect((await transfer.POST(req("POST", { newOwnerId: EDITOR }), params({ planId }))).status).toBe(403);
    expect((await one.DELETE(req("DELETE"), params({ planId }))).status).toBe(403);
  });

  it("returns 409 when settings were changed by someone else", async () => {
    as(OWNER);
    const res = await one.PATCH(req("PATCH", { expectedVersion: 1, settings: { name: "B" } }), params({ planId }));
    expect(res.status).toBe(409);
  });

  it("editors edit availability, Sprint names, members and sharing", async () => {
    as(EDITOR);
    const a = await availability.PATCH(req("PATCH", { memberId: OWNER, days: { "2026-10-05": 0.5 } }), params({ planId }));
    expect(a.status).toBe(200);
    expect((await a.json()).days).toEqual({ "2026-10-05": 0.5 });
    expect((await sprintNames.PUT(req("PUT", { names: { "2026-10-05": "Kickoff" } }), params({ planId }))).status).toBe(200);
    expect((await members.POST(req("POST", { identifier: "sam@example.com" }), params({ planId }))).status).toBe(200);
    expect((await access.PUT(req("PUT", { userId: STRANGER, role: "view" }), params({ planId }))).status).toBe(200);
    expect((await accessOne.DELETE(req("DELETE"), params({ planId, userId: STRANGER }))).status).toBe(200);
    expect((await memberOne.DELETE(req("DELETE"), params({ planId, userId: STRANGER }))).status).toBe(200);
  });

  it("nobody can change the owner's access", async () => {
    as(EDITOR);
    expect((await access.PUT(req("PUT", { userId: OWNER, role: "view" }), params({ planId }))).status).toBe(403);
    expect((await accessOne.DELETE(req("DELETE"), params({ planId, userId: OWNER }))).status).toBe(403);
  });

  it("read-only users can't write anything", async () => {
    as(VIEWER);
    expect((await availability.PATCH(req("PATCH", { memberId: OWNER, days: { "2026-10-05": 0.5 } }), params({ planId }))).status).toBe(403);
    expect((await sprintNames.PUT(req("PUT", { names: { "2026-10-05": "X" } }), params({ planId }))).status).toBe(403);
    expect((await members.POST(req("POST", { userId: STRANGER }), params({ planId }))).status).toBe(403);
    expect((await access.PUT(req("PUT", { userId: STRANGER, role: "edit" }), params({ planId }))).status).toBe(403);
  });

  it("validates availability values", async () => {
    as(OWNER);
    const res = await availability.PATCH(req("PATCH", { memberId: OWNER, days: { "2026-10-05": 0.3 } }), params({ planId }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when sharing with an unknown user", async () => {
    as(OWNER);
    expect((await access.PUT(req("PUT", { identifier: "nobody@example.com", role: "view" }), params({ planId }))).status).toBe(404);
  });

  it("reports when the caller removed their own access", async () => {
    as(EDITOR);
    const res = await accessOne.DELETE(req("DELETE"), params({ planId, userId: EDITOR }));
    expect(await res.json()).toEqual({ removed: true });
  });

  it("lets non-owners leave and the owner transfer", async () => {
    as(VIEWER);
    expect((await leave.POST(req("POST"), params({ planId }))).status).toBe(200);
    as(OWNER);
    expect((await leave.POST(req("POST"), params({ planId }))).status).toBe(400);
    const res = await transfer.POST(req("POST", { newOwnerId: EDITOR }), params({ planId }));
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("edit");
  });
});

describe("team members without an account", () => {
  it("creates a plan with them and shows them as rows only", async () => {
    as(OWNER);
    const res = await list.POST(req("POST", { ...settings, memberIds: [OWNER], guestNames: [" Casey Contractor "] }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.members.map((m) => [m.fullName, !!m.guest])).toEqual([
      ["Olive Owner", false],
      ["Casey Contractor", true],
    ]);
    expect(data.access).toHaveLength(1);
  });

  it("validates their names and the member limit", async () => {
    as(OWNER);
    expect((await list.POST(req("POST", { ...settings, guestNames: ["<script>"] }))).status).toBe(400);
    expect((await list.POST(req("POST", { ...settings, guestNames: [""] }))).status).toBe(400);
    expect((await list.POST(req("POST", { ...settings, guestNames: Array.from({ length: 51 }, (_, i) => `P${i}`) }))).status).toBe(400);
  });

  it("lets editors add and rename them, and exports their names", async () => {
    const planId = await createPlan();
    as(EDITOR);
    const added = await (await members.POST(req("POST", { guestName: "Pat Temp" }), params({ planId }))).json();
    const guest = added.members.find((m) => m.guest);
    expect(guest.fullName).toBe("Pat Temp");
    const renamed = await memberOne.PATCH(req("PATCH", { name: "Pat Temporary" }), params({ planId, userId: guest.userId }));
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).members.find((m) => m.guest).fullName).toBe("Pat Temporary");
    expect((await memberOne.PATCH(req("PATCH", { name: "X" }), params({ planId, userId: OWNER }))).status).toBe(404);

    as(VIEWER);
    expect((await members.POST(req("POST", { guestName: "Nope" }), params({ planId }))).status).toBe(403);
    const csv = await (await exporter.GET(req("GET", undefined, `http://localhost/x?format=csv&from=2026-10-05&to=2026-10-18`), params({ planId }))).text();
    expect(csv).toContain("Pat Temporary,20,20");
  });
});

describe("linking a team member to an account", () => {
  it("links by email and moves the row to the account", async () => {
    const planId = await createPlan();
    as(EDITOR);
    const added = await (await members.POST(req("POST", { guestName: "Sam (temp)" }), params({ planId }))).json();
    const guest = added.members.find((m) => m.guest);
    await availability.PATCH(req("PATCH", { memberId: guest.userId, days: { "2026-10-05": 0 } }), params({ planId }));

    const res = await memberLink.POST(req("POST", { identifier: "sam@example.com" }), params({ planId, userId: guest.userId }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.members.map((m) => m.fullName)).toEqual(["Olive Owner", "Ed Editor", "Sam Stranger"]);
    expect(data.members.some((m) => m.guest)).toBe(false);
    expect(data.availability[STRANGER]).toEqual({ "2026-10-05": 0 });
    expect(data.access).toContainEqual(expect.objectContaining({ userId: STRANGER, role: "edit" }));
  });

  it("returns 404 for unknown accounts or rows that already have one, 403 for read-only users", async () => {
    const planId = await createPlan();
    as(OWNER);
    const added = await (await members.POST(req("POST", { guestName: "Temp" }), params({ planId }))).json();
    const guestId = added.members.find((m) => m.guest).userId;
    expect((await memberLink.POST(req("POST", { identifier: "nobody@example.com" }), params({ planId, userId: guestId }))).status).toBe(404);
    expect((await memberLink.POST(req("POST", { userId: STRANGER }), params({ planId, userId: EDITOR }))).status).toBe(404);
    expect((await memberLink.POST(req("POST", { userId: EDITOR }), params({ planId, userId: guestId }))).status).toBe(400);
    as(VIEWER);
    expect((await memberLink.POST(req("POST", { userId: STRANGER }), params({ planId, userId: guestId }))).status).toBe(403);
  });
});

describe("export", () => {
  const exportReq = (planId, qs) => req("GET", undefined, `http://localhost/api/capacity-plans/${planId}/export?${qs}`);

  it("exports CSV for read-only users", async () => {
    const planId = await createPlan();
    as(VIEWER);
    const res = await exporter.GET(exportReq(planId, "format=csv&from=2026-10-05&to=2026-10-18"), params({ planId }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="Team-A_2026-10-05_2026-10-18.csv"');
    const text = await res.text();
    expect(text).toContain("Olive Owner,20,20");
    expect(text).toContain("Team total,40,40");
  });

  it("exports an Excel workbook", async () => {
    const planId = await createPlan();
    as(OWNER);
    const res = await exporter.GET(exportReq(planId, "format=xlsx&from=2026-10-05&to=2026-11-01"), params({ planId }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/spreadsheetml/);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe("PK"); // zip container
  });

  it("validates the query and hides plans from strangers", async () => {
    const planId = await createPlan();
    as(OWNER);
    expect((await exporter.GET(exportReq(planId, "format=pdf&from=2026-10-05&to=2026-10-18"), params({ planId }))).status).toBe(400);
    as(STRANGER);
    expect((await exporter.GET(exportReq(planId, "format=csv&from=2026-10-05&to=2026-10-18"), params({ planId }))).status).toBe(404);
  });
});

describe("aggregate and deletion review", () => {
  it("returns accessible plans and lists the rest as inaccessible", async () => {
    const planId = await createPlan();
    as(VIEWER);
    const res = await aggregate.GET(req("GET", undefined, `http://localhost/api/capacity-plans/aggregate?ids=${planId},${MISSING}`));
    const data = await res.json();
    expect(data.plans.map((p) => p.plan.planId)).toEqual([planId]);
    expect(data.inaccessible).toEqual([MISSING]);
  });

  it("rejects more than 10 plans", async () => {
    as(OWNER);
    const ids = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`);
    expect((await aggregate.GET(req("GET", undefined, `http://localhost/api/capacity-plans/aggregate?ids=${ids.join(",")}`))).status).toBe(400);
  });

  it("lists the plans that need an ownership decision, with names", async () => {
    const planId = await createPlan();
    as(OWNER);
    const data = await (await review.GET()).json();
    expect(data.autoDelete).toEqual([]);
    expect(data.needsDecision).toEqual([
      expect.objectContaining({ planId, candidates: [expect.objectContaining({ userId: EDITOR, fullName: "Ed Editor", atLimit: false })] }),
    ]);
  });
});
