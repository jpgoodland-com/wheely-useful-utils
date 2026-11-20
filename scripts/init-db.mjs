import { DynamoDBClient, CreateTableCommand, ListTablesCommand } from "@aws-sdk/client-dynamodb";

const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint,
  credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "fakeMyKeyId",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "fakeSecretAccessKey",
  }
});

const TableNames = {
  Users: "WheelApp_Users",
  Wheels: "WheelApp_Wheels",
  CoinFlip: "WheelApp_CoinFlip",
  CapacityPlans: "WheelApp_CapacityPlans",
  Audit: "WheelApp_Audit",
};

// DynamoDB Local takes a few seconds to accept connections after its
// container starts, so retry the first call instead of sleeping up front.
async function listTables(attempts = Number(process.env.INIT_DB_ATTEMPTS) || 15, delayMs = 1000) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.send(new ListTablesCommand({}));
    } catch (err) {
      if (attempt >= attempts) throw err;
      console.log(`Waiting for DynamoDB at ${endpoint} (${attempt}/${attempts})...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function init() {
  const { TableNames: existingTables } = await listTables();

  if (!existingTables.includes(TableNames.Users)) {
    console.log(`Creating ${TableNames.Users}...`);
    await client.send(new CreateTableCommand({
      TableName: TableNames.Users,
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "EmailOrUsername", AttributeType: "S" } // For LSI/GSI if we want fast lookup, but we can just use PK=USER#email
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" } // PK: USER#<email_or_something> 
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "EmailOrUsernameIndex",
          KeySchema: [
            { AttributeName: "EmailOrUsername", KeyType: "HASH" }
          ],
          Projection: { ProjectionType: "ALL" },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
        }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5,
      }
    }));
  }

  if (!existingTables.includes(TableNames.Wheels)) {
    console.log(`Creating ${TableNames.Wheels}...`);
    await client.send(new CreateTableCommand({
      TableName: TableNames.Wheels,
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" }, // WHEEL#<id>
        { AttributeName: "ownerId", AttributeType: "S" }, // M4: for OwnerIdIndex GSI
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "OwnerIdIndex",
          KeySchema: [
            { AttributeName: "ownerId", KeyType: "HASH" }
          ],
          Projection: { ProjectionType: "ALL" },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
        }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5,
      }
    }));
  }

  if (!existingTables.includes(TableNames.CoinFlip)) {
    console.log(`Creating ${TableNames.CoinFlip}...`);
    await client.send(new CreateTableCommand({
      TableName: TableNames.CoinFlip,
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" }, // COINFLIP#CONFIG#<userId> | COINFLIP#HISTORY#<userId>
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5,
      }
    }));
  }

  if (!existingTables.includes(TableNames.CapacityPlans)) {
    console.log(`Creating ${TableNames.CapacityPlans}...`);
    await client.send(new CreateTableCommand({
      TableName: TableNames.CapacityPlans,
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" }, // PLAN#<id> | PLANACCESS#<planId>#<userId> | PLANAVAIL#<planId>#<memberId> | PLANQUOTA#<userId>
        { AttributeName: "userId", AttributeType: "S" }, // only set on PLANACCESS items (sparse UserIdIndex)
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "UserIdIndex",
          KeySchema: [
            { AttributeName: "userId", KeyType: "HASH" }
          ],
          Projection: { ProjectionType: "ALL" },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
        }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5,
      }
    }));
  }

  if (!existingTables.includes(TableNames.Audit)) {
    console.log(`Creating ${TableNames.Audit}...`);
    await client.send(new CreateTableCommand({
      TableName: TableNames.Audit,
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" }, // AUDIT#<ts>#<random>, append-only
        { AttributeName: "scope", AttributeType: "S" }, // "platform" | "user#<userId>"
        { AttributeName: "ts", AttributeType: "S" }, // ISO timestamp + random suffix
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "ScopeIndex",
          KeySchema: [
            { AttributeName: "scope", KeyType: "HASH" },
            { AttributeName: "ts", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
        }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5,
      }
    }));
  }

  console.log("Database initialized.");
}

// Exit non-zero on failure so docker compose's service_completed_successfully
// (and anything else waiting on this script) sees it.
init().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
