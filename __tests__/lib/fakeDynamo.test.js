import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createFakeDynamo } from "@/__tests__/helpers/fakeDynamo";

const T = "T";
let db;
beforeEach(() => {
  db = createFakeDynamo();
});

describe("fakeDynamo updates", () => {
  it("applies SET with names and values", async () => {
    db.put(T, { PK: "a", x: 1 });
    await db.send(new UpdateCommand({
      TableName: T, Key: { PK: "a" },
      UpdateExpression: "SET #pw = :p, y = :y",
      ExpressionAttributeNames: { "#pw": "password" },
      ExpressionAttributeValues: { ":p": "h", ":y": 2 },
    }));
    expect(db.get(T, "a")).toEqual({ PK: "a", x: 1, password: "h", y: 2 });
  });

  it("applies SET followed by REMOVE", async () => {
    db.put(T, { PK: "a", tok: "t", exp: 1, keep: true });
    await db.send(new UpdateCommand({
      TableName: T, Key: { PK: "a" },
      UpdateExpression: "SET v = :v REMOVE tok, exp",
      ExpressionAttributeValues: { ":v": true },
    }));
    expect(db.get(T, "a")).toEqual({ PK: "a", v: true, keep: true });
  });

  it("applies REMOVE alone", async () => {
    db.put(T, { PK: "a", tok: "t" });
    await db.send(new UpdateCommand({ TableName: T, Key: { PK: "a" }, UpdateExpression: "REMOVE tok" }));
    expect(db.get(T, "a")).toEqual({ PK: "a" });
  });

  it("still supports ADD", async () => {
    await db.send(new UpdateCommand({ TableName: T, Key: { PK: "q" }, UpdateExpression: "ADD n :one", ExpressionAttributeValues: { ":one": 1 } }));
    expect(db.get(T, "q").n).toBe(1);
  });

  it("applies ADD and SET together and returns the new item", async () => {
    const res = await db.send(new UpdateCommand({
      TableName: T, Key: { PK: "r" },
      UpdateExpression: "ADD hits :one SET expiresAt = :exp",
      ExpressionAttributeValues: { ":one": 1, ":exp": 99 },
      ReturnValues: "ALL_NEW",
    }));
    expect(res.Attributes).toEqual({ PK: "r", hits: 1, expiresAt: 99 });
    const again = await db.send(new UpdateCommand({
      TableName: T, Key: { PK: "r" }, UpdateExpression: "ADD hits :one", ExpressionAttributeValues: { ":one": 1 }, ReturnValues: "UPDATED_NEW",
    }));
    expect(again.Attributes.hits).toBe(2);
  });

  it("throws on unsupported update syntax", async () => {
    await expect(db.send(new UpdateCommand({
      TableName: T, Key: { PK: "a" }, UpdateExpression: "SET a = list_append(a, :x)", ExpressionAttributeValues: { ":x": [] },
    }))).rejects.toThrow(/unsupported/);
  });
});

describe("fakeDynamo conditions", () => {
  it("checks a single attribute equality", async () => {
    db.put(T, { PK: "a", h: "x" });
    const update = (h) => db.send(new UpdateCommand({
      TableName: T, Key: { PK: "a" }, UpdateExpression: "REMOVE h",
      ConditionExpression: "h = :h", ExpressionAttributeValues: { ":h": h },
    }));
    await expect(update("wrong")).rejects.toMatchObject({ name: "ConditionalCheckFailedException" });
    await update("x");
    await expect(update("x")).rejects.toMatchObject({ name: "ConditionalCheckFailedException" });
  });

  it("checks attribute_exists(PK)", async () => {
    const put = () => db.send(new PutCommand({ TableName: T, Item: { PK: "z" }, ConditionExpression: "attribute_exists(PK)" }));
    await expect(put()).rejects.toMatchObject({ name: "ConditionalCheckFailedException" });
    db.put(T, { PK: "z" });
    await put();
    expect((await db.send(new GetCommand({ TableName: T, Key: { PK: "z" } }))).Item).toEqual({ PK: "z" });
  });

  it("throws on unsupported conditions", async () => {
    await expect(db.send(new PutCommand({ TableName: T, Item: { PK: "a" }, ConditionExpression: "size(x) > :n" })))
      .rejects.toThrow(/unsupported condition/);
  });
});
