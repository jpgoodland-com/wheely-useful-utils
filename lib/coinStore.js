import { docClient, TableNames } from "@/lib/dynamodb";
import { GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { tossMany, HISTORY_LIMIT, HEADS } from "@/lib/coinFlip";
import {
  MAX_CUSTOM_CONFIGS,
  DEFAULT_ACTIVE_ID,
  isPresetId,
  isValidConfigId,
  ConfigError,
} from "@/lib/coinConfig";

export class ConflictError extends Error {}

const configKey = (userId) => ({ PK: `COINFLIP#CONFIG#${userId}` });
const historyKey = (userId) => ({ PK: `COINFLIP#HISTORY#${userId}` });

const toChar = (r) => (r === HEADS ? "H" : "T");
const fromChar = (c) => (c === "H" ? "heads" : "tails");

async function getItem(key) {
  const res = await docClient.send(new GetCommand({ TableName: TableNames.CoinFlip, Key: key }));
  return res.Item || null;
}

async function putVersioned(key, fields, prev) {
  const now = Date.now();
  try {
    await docClient.send(
      new PutCommand({
        TableName: TableNames.CoinFlip,
        Item: { ...key, ...fields, updatedAt: now },
        ...(prev
          ? {
              ConditionExpression: "updatedAt = :prev",
              ExpressionAttributeValues: { ":prev": prev.updatedAt },
            }
          : { ConditionExpression: "attribute_not_exists(PK)" }),
      })
    );
  } catch (e) {
    if (e?.name === "ConditionalCheckFailedException") throw new ConflictError("Concurrent update");
    throw e;
  }
}

function historyView(item) {
  const chars = item?.results || "";
  return {
    results: chars.split("").map(fromChar),
    totals: { heads: item?.heads || 0, tails: item?.tails || 0 },
  };
}

export async function getCoinState(userId) {
  const [cfg, hist] = await Promise.all([getItem(configKey(userId)), getItem(historyKey(userId))]);
  return {
    configs: cfg?.configs || [],
    activeId: cfg?.activeId || DEFAULT_ACTIVE_ID,
    ...historyView(hist),
  };
}

export async function saveConfig(userId, config) {
  const cur = await getItem(configKey(userId));
  const configs = [...(cur?.configs || [])];
  const idx = configs.findIndex((c) => c.id === config.id);
  if (idx === -1) {
    if (configs.length >= MAX_CUSTOM_CONFIGS) {
      throw new ConfigError(`You can save up to ${MAX_CUSTOM_CONFIGS} custom coins`);
    }
    configs.push(config);
  } else {
    configs[idx] = config;
  }
  await putVersioned(configKey(userId), { configs, activeId: cur?.activeId || DEFAULT_ACTIVE_ID }, cur);
  return configs;
}

export async function deleteConfig(userId, id) {
  const cur = await getItem(configKey(userId));
  if (!cur) return false;
  const configs = cur.configs.filter((c) => c.id !== id);
  if (configs.length === cur.configs.length) return false;
  const activeId = cur.activeId === id ? DEFAULT_ACTIVE_ID : cur.activeId;
  await putVersioned(configKey(userId), { configs, activeId }, cur);
  return true;
}

export async function setActive(userId, id) {
  const cur = await getItem(configKey(userId));
  const exists = isPresetId(id) || (isValidConfigId(id) && (cur?.configs || []).some((c) => c.id === id));
  if (!exists) return false;
  await putVersioned(configKey(userId), { configs: cur?.configs || [], activeId: id }, cur);
  return true;
}

/** Toss using the server-held history, persist, and return the new results. */
export async function tossAndStore(userId, count) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await getItem(historyKey(userId));
    const { results: prior } = historyView(cur);
    const results = tossMany(count, prior);
    const merged = (cur?.results || "") + results.map(toChar).join("");
    const heads = (cur?.heads || 0) + results.filter((r) => r === HEADS).length;
    const tails = (cur?.tails || 0) + results.length - results.filter((r) => r === HEADS).length;
    try {
      await putVersioned(
        historyKey(userId),
        { results: merged.slice(-HISTORY_LIMIT), heads, tails },
        cur
      );
      return { results, totals: { heads, tails } };
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new ConflictError("Concurrent update");
}

export async function clearHistory(userId) {
  await docClient.send(new DeleteCommand({ TableName: TableNames.CoinFlip, Key: historyKey(userId) }));
}

/** Remove everything stored for a user (account deletion). */
export async function deleteAllCoinData(userId) {
  await docClient.send(new DeleteCommand({ TableName: TableNames.CoinFlip, Key: configKey(userId) }));
  await clearHistory(userId);
}
