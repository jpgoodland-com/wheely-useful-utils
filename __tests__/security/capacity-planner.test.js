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
const exporter = require("@/app/api/capacity-plans/[planId]/export/route");

const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";

const settings = { name: "Team", timeZone: "UTC", cadenceStart: "2026-10-05" };
const as = (userId) => getSession.mockResolvedValue({ userId });
const params = (planId) => ({ params: Promise.resolve({ planId }) });
const rawReq = (method, text, url = "http://localhost/api/capacity-plans") =>
  new Request(url, { method, body: text, headers: { "content-type": "application/json" } });
const req = (method, body, url) => rawReq(method, JSON.stringify(body), url);

async function create(owner, body = {}) {
  as(owner);
  const res = await list.POST(req("POST", { ...settings, memberIds: [owner], ...body }));
  return (await res.json()).plan;
}

beforeEach(() => {
  docClient.reset();
  for (const [id, name] of [[ALICE, "alice"], [BOB, "bob"]]) {
    docClient.put("WheelApp_Users", { PK: `USER#${id}`, userId: id, username: name, firstName: name, email: `${name}@example.com` });
  }
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("capacity planner security", () => {
  it("rejects prototype pollution payloads", async () => {
    as(ALICE);
    const res = await list.POST(rawReq("POST", '{"name":"x","timeZone":"UTC","cadenceStart":"2026-10-05","__proto__":{"isAdmin":true}}'));
    expect(res.status).toBe(400);
    expect({}.isAdmin).toBeUndefined();

    const plan = await create(ALICE);
    as(ALICE);
    const patch = await availability.PATCH(rawReq("PATCH", `{"memberId":"${ALICE}","days":{"__proto__":{"x":0}}}`), params(plan.planId));
    expect(patch.status).toBe(400);
  });

  it("never stores unknown fields from the client", async () => {
    const plan = await create(ALICE, { ownerId: BOB, access: { [BOB]: "edit" }, version: 99 });
    expect(plan.ownerId).toBe(ALICE);
    expect(plan.access).toEqual({});
    expect(plan.version).toBe(1);
  });

  it("does not let one plan's owner touch another plan (IDOR)", async () => {
    const alicePlan = await create(ALICE);
    await create(BOB);
    as(BOB);
    expect((await one.GET(req("GET"), params(alicePlan.planId))).status).toBe(404);
    expect((await one.DELETE(req("DELETE"), params(alicePlan.planId))).status).toBe(404);
    expect((await availability.PATCH(req("PATCH", { memberId: ALICE, days: { "2026-10-05": 0 } }), params(alicePlan.planId))).status).toBe(404);
    const exportRes = await exporter.GET(rawReq("GET", undefined, `http://localhost/x?format=csv&from=2026-10-05&to=2026-10-11`), params(alicePlan.planId));
    expect(exportRes.status).toBe(404);
  });

  it("only accepts availability for the plan's own team members", async () => {
    const plan = await create(ALICE);
    as(ALICE);
    const res = await availability.PATCH(req("PATCH", { memberId: BOB, days: { "2026-10-05": 0 } }), params(plan.planId));
    expect(res.status).toBe(400);
    expect(docClient.get("WheelApp_CapacityPlans", `PLANAVAIL#${plan.planId}#${BOB}`)).toBeUndefined();
  });

  it("neutralizes spreadsheet formulas in exported names", async () => {
    docClient.put("WheelApp_Users", { PK: `USER#${BOB}`, userId: BOB, username: "bob", firstName: "=HYPERLINK(\"http://evil\")", email: "bob@example.com" });
    const plan = await create(ALICE, { name: "Team", memberIds: [ALICE, BOB] });
    as(ALICE);
    const res = await exporter.GET(rawReq("GET", undefined, `http://localhost/x?format=csv&from=2026-10-05&to=2026-10-11`), params(plan.planId));
    const text = await res.text();
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text).not.toMatch(/^=HYPERLINK/m);
  });

  it("does not leak internal errors", async () => {
    const plan = await create(ALICE);
    docClient.beforeSend = () => {
      throw new Error("ProvisionedThroughputExceeded: secret internal detail");
    };
    as(ALICE);
    const res = await one.GET(req("GET"), params(plan.planId));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Error" });
  });
});
