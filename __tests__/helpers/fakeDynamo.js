// Minimal in-memory DynamoDB document client for tests. Supports only the
// commands and condition expressions the app uses, and throws on anything else
// so unsupported usage fails loudly instead of passing silently.

function conditionHolds(item, { ConditionExpression, ExpressionAttributeNames = {}, ExpressionAttributeValues = {} }) {
  if (!ConditionExpression) return true;
  switch (ConditionExpression) {
    case "attribute_not_exists(PK)":
      return !item;
    case "#v = :v":
      return !!item && item[ExpressionAttributeNames["#v"]] === ExpressionAttributeValues[":v"];
    case "attribute_not_exists(ownedCount) OR ownedCount < :max":
      return !item || item.ownedCount === undefined || item.ownedCount < ExpressionAttributeValues[":max"];
    case "attribute_exists(PK)":
      return !!item;
    default: {
      // Single equality on a stored attribute, e.g. "passwordResetTokenHash = :h".
      const m = /^(#?\w+) = (:\w+)$/.exec(ConditionExpression);
      if (!m) throw new Error(`fakeDynamo: unsupported condition "${ConditionExpression}"`);
      const attr = m[1].startsWith("#") ? ExpressionAttributeNames[m[1]] : m[1];
      return !!item && item[attr] === ExpressionAttributeValues[m[2]];
    }
  }
}

function conditionalFailure() {
  return Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
}

export function createFakeDynamo() {
  const tables = new Map();
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));

  // Supports any mix of "SET a = :x, #b = :y", "ADD n :v" and "REMOVE c, d"
  // clauses, in any order. Like DynamoDB, a missing item is created.
  function applyUpdate(t, { Key, UpdateExpression, ExpressionAttributeNames = {}, ExpressionAttributeValues = {} }) {
    const item = t.get(Key.PK) || { ...Key };
    const name = (n) => (n.startsWith("#") ? ExpressionAttributeNames[n] : n);
    const clauses = [...UpdateExpression.trim().matchAll(/(SET|ADD|REMOVE)\s+(.*?)(?=\s+(?:SET|ADD|REMOVE)\s|$)/g)];
    if (!clauses.length || clauses.map((c) => c[0]).join(" ").replace(/\s+/g, " ") !== UpdateExpression.trim().replace(/\s+/g, " ")) {
      throw new Error(`fakeDynamo: unsupported update "${UpdateExpression}"`);
    }
    for (const [, kind, body] of clauses) {
      for (const part of body.split(",")) {
        if (kind === "SET") {
          const sm = /^\s*(#?\w+) = (:\w+)\s*$/.exec(part);
          if (!sm) throw new Error(`fakeDynamo: unsupported SET clause "${part}"`);
          item[name(sm[1])] = clone(ExpressionAttributeValues[sm[2]]);
        } else if (kind === "ADD") {
          const am = /^\s*(#?\w+) (:\w+)\s*$/.exec(part);
          if (!am) throw new Error(`fakeDynamo: unsupported ADD clause "${part}"`);
          item[name(am[1])] = (item[name(am[1])] || 0) + ExpressionAttributeValues[am[2]];
        } else {
          const attr = part.trim();
          if (!/^#?\w+$/.test(attr)) throw new Error(`fakeDynamo: unsupported REMOVE clause "${part}"`);
          delete item[name(attr)];
        }
      }
    }
    t.set(Key.PK, item);
    return item;
  }

  const handlers = {
    GetCommand: ({ TableName, Key }) => ({ Item: clone(table(TableName).get(Key.PK)) }),

    PutCommand: (input) => {
      const t = table(input.TableName);
      if (!conditionHolds(t.get(input.Item.PK), input)) throw conditionalFailure();
      t.set(input.Item.PK, clone(input.Item));
      return {};
    },

    DeleteCommand: (input) => {
      const t = table(input.TableName);
      if (!conditionHolds(t.get(input.Key.PK), input)) throw conditionalFailure();
      t.delete(input.Key.PK);
      return {};
    },

    UpdateCommand: (input) => {
      const t = table(input.TableName);
      if (!conditionHolds(t.get(input.Key.PK), input)) throw conditionalFailure();
      const item = applyUpdate(t, input);
      if (input.ReturnValues === "ALL_NEW" || input.ReturnValues === "UPDATED_NEW") return { Attributes: clone(item) };
      if (input.ReturnValues) throw new Error(`fakeDynamo: unsupported ReturnValues ${input.ReturnValues}`);
      return {};
    },

    BatchGetCommand: ({ RequestItems }) => {
      const Responses = {};
      for (const [name, { Keys }] of Object.entries(RequestItems)) {
        Responses[name] = Keys.map((k) => clone(table(name).get(k.PK))).filter(Boolean);
      }
      return { Responses, UnprocessedKeys: {} };
    },

    QueryCommand: ({ TableName, KeyConditionExpression, ExpressionAttributeNames = {}, ExpressionAttributeValues }) => {
      const m = /^(#?\w+) = (:\w+)$/.exec(KeyConditionExpression);
      if (!m) throw new Error(`fakeDynamo: unsupported key condition "${KeyConditionExpression}"`);
      const attr = m[1].startsWith("#") ? ExpressionAttributeNames[m[1]] : m[1];
      const value = ExpressionAttributeValues[m[2]];
      return { Items: [...table(TableName).values()].filter((i) => i[attr] === value).map(clone) };
    },

    ScanCommand: ({ TableName }) => ({ Items: [...table(TableName).values()].map(clone) }),

    TransactWriteCommand: ({ TransactItems }) => {
      const pks = TransactItems.map((op) => {
        const [, input] = Object.entries(op)[0];
        return `${input.TableName}|${(input.Item || input.Key).PK}`;
      });
      if (new Set(pks).size !== pks.length) throw new Error("fakeDynamo: transaction touches an item twice");

      const results = TransactItems.map((op) => {
        const [, input] = Object.entries(op)[0];
        const key = (input.Item || input.Key).PK;
        return conditionHolds(table(input.TableName).get(key), input);
      });
      if (results.includes(false)) {
        throw Object.assign(new Error("Transaction cancelled"), {
          name: "TransactionCanceledException",
          CancellationReasons: results.map((ok) => ({ Code: ok ? "None" : "ConditionalCheckFailed" })),
        });
      }
      for (const op of TransactItems) {
        const [type, input] = Object.entries(op)[0];
        const t = table(input.TableName);
        if (type === "Put") t.set(input.Item.PK, clone(input.Item));
        else if (type === "Delete") t.delete(input.Key.PK);
        else if (type === "Update") applyUpdate(t, input);
        else if (type === "ConditionCheck") continue;
        else throw new Error(`fakeDynamo: unsupported transaction op ${type}`);
      }
      return {};
    },
  };

  const client = {
    calls: [],
    /** Optional hook run before each command; may mutate state to simulate races. */
    beforeSend: null,
    async send(command) {
      const name = command.constructor.name;
      client.calls.push({ name, input: command.input });
      if (client.beforeSend) await client.beforeSend(name, command.input, client);
      const handler = handlers[name];
      if (!handler) throw new Error(`fakeDynamo: unsupported command ${name}`);
      return handler(command.input);
    },
    get: (tableName, pk) => clone(table(tableName).get(pk)),
    put: (tableName, item) => table(tableName).set(item.PK, clone(item)),
    items: (tableName) => [...table(tableName).values()].map(clone),
    reset() {
      tables.clear();
      client.calls = [];
      client.beforeSend = null;
    },
  };
  return client;
}
