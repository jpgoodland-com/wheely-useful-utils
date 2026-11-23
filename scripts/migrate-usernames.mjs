// Renames usernames that break the username rule (C1 in the security plan).
//
// Usernames used to accept any string, including email addresses. A
// username such as "ceo@corp.com" shares the EmailOrUsername GSI key with
// that email, which let it capture the real owner's OAuth sign-in. The app
// no longer treats a username pointer as an email match, but these
// usernames should still go: each one gets a valid replacement, and the
// report lists them so the users can be told.
//
//   node scripts/migrate-usernames.mjs            # dry run (default)
//   node scripts/migrate-usernames.mjs --apply    # write changes
//
// Idempotent: valid usernames are left alone, so a second run does nothing.
import crypto from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const TABLE = "WheelApp_Users";
const apply = process.argv.includes("--apply");

const client = DynamoDBDocumentClient.from(new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  ...(process.env.DYNAMODB_ENDPOINT ? {
    endpoint: process.env.DYNAMODB_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "fakeMyKeyId",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "fakeSecretAccessKey",
    },
  } : {}),
}));

export function replacementBase(username) {
  let base = String(username).toLowerCase().split("@")[0]
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 20);
  if (base.length < 3) base = `user${base}`;
  return base;
}

async function scanAll() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await client.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function main() {
  const items = await scanAll();
  const taken = new Set(items.map((i) => i.EmailOrUsername).filter(Boolean));
  const pointers = items.filter((i) => i.PK?.startsWith("USER#USERNAME#") && !USERNAME_RE.test(i.username || ""));
  const report = [];

  for (const pointer of pointers) {
    let next = replacementBase(pointer.username);
    while (!USERNAME_RE.test(next) || taken.has(next)) {
      next = `${replacementBase(pointer.username)}_${crypto.randomBytes(3).toString("hex")}`;
    }
    taken.add(next);
    report.push({ userId: pointer.userId, from: pointer.username, to: next });

    if (!apply) continue;
    const { PK: _pk, ...rest } = pointer;
    await client.send(new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: TABLE, Item: { ...rest, PK: `USER#USERNAME#${next}`, username: next, EmailOrUsername: next }, ConditionExpression: "attribute_not_exists(PK)" } },
        { Delete: { TableName: TABLE, Key: { PK: pointer.PK } } },
        { Update: {
          TableName: TABLE,
          Key: { PK: `USER#${pointer.userId}` },
          UpdateExpression: "SET username = :u",
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeValues: { ":u": next },
        } },
      ],
    }));
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", renamed: report.length, users: report }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
