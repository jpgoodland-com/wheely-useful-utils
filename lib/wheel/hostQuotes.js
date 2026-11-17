export const QUOTE_CATEGORIES = [
  "spinStart",
  "waiting",
  "slowing",
  "result",
  "repeatWinner",
  "idle",
  "error",
];

export const KNOWN_PLACEHOLDERS = ["winner", "random", "wheel", "wins"];

const MAX_QUOTE_LENGTH = 120;
const MAX_QUOTES_PER_CATEGORY = 200;
const MAX_NAME_LENGTH = 40;
const DEFAULT_BUBBLE_MS = 2800;

export const DEFAULT_QUOTES = {
  spinStart: ["Hold onto your hats!", "Here we go!", "Give it a good one!"],
  waiting: ["I think {random} is feeling lucky.", "Look at that thing go!", "Nobody breathe."],
  slowing: ["Is it going to stop? Nobody knows!", "Come on, come on..."],
  result: ["I think {winner} will go again!", "{winner}! Didn't see that coming. Okay, I did."],
  repeatWinner: ["{winner} AGAIN?!", "{winner}, you must know somebody."],
  idle: ["Come on down!", "Who's ready to spin?"],
  error: ["Well, that didn't work. Spin again?"],
};

const PLACEHOLDER_RE = /\{(\w+)\}/g;

function neededPlaceholders(str) {
  const found = [];
  for (const m of str.matchAll(PLACEHOLDER_RE)) {
    if (KNOWN_PLACEHOLDERS.includes(m[1])) found.push(m[1]);
  }
  return found;
}

function clip(value) {
  const s = String(value ?? "").trim();
  return s.length > MAX_NAME_LENGTH ? `${s.slice(0, MAX_NAME_LENGTH - 1)}…` : s;
}

function mergeRaw(rawList) {
  const merged = {};
  for (const category of QUOTE_CATEGORIES) {
    merged[category] = rawList.flatMap((raw) => {
      const list = raw && raw.quotes && typeof raw.quotes === "object" ? raw.quotes[category] : null;
      return Array.isArray(list) ? list : [];
    });
  }
  const ms = rawList.map((r) => Number(r && r.bubbleMs)).filter((n) => Number.isFinite(n)).pop();
  return { quotes: merged, bubbleMs: ms };
}

export function sanitizeQuotes(raw) {
  const quotes = {};
  const source = raw && typeof raw === "object" && raw.quotes && typeof raw.quotes === "object" ? raw.quotes : {};
  for (const category of QUOTE_CATEGORIES) {
    const list = Array.isArray(source[category]) ? source[category] : [];
    const clean = list
      .filter((q) => typeof q === "string" && q.trim().length > 0)
      .slice(0, MAX_QUOTES_PER_CATEGORY)
      .map((q) => q.trim().slice(0, MAX_QUOTE_LENGTH));
    quotes[category] = clean.length > 0 ? clean : [...DEFAULT_QUOTES[category]];
  }
  const ms = Number(raw && raw.bubbleMs);
  const bubbleMs = Number.isFinite(ms) ? Math.min(Math.max(ms, 1000), 8000) : DEFAULT_BUBBLE_MS;
  return { quotes, bubbleMs };
}

// Merges parsed quote files per category (later files add to earlier ones; the last bubbleMs wins).
// Non-objects are skipped; if nothing usable is left, the built-in lines are used.
export function buildQuotes(rawList) {
  const ok = (rawList || []).filter((raw) => raw && typeof raw === "object");
  return ok.length === 0 ? sanitizeQuotes(null) : sanitizeQuotes(mergeRaw(ok));
}

// ctx values are user data. They are only ever substituted into plain text.
export function fillTemplate(str, ctx = {}) {
  const filled = str.replace(PLACEHOLDER_RE, (_, key) => {
    if (!KNOWN_PLACEHOLDERS.includes(key)) return "";
    const v = ctx[key];
    return v == null ? "" : clip(v);
  });
  return filled.replace(/\s+/g, " ").trim();
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shuffle-bag picker: every line is used before any repeats, and never the same line twice in a row.
export function createQuotePicker(quotes, rng = Math.random) {
  const bags = {};
  const last = {};

  return function pick(category, ctx = {}) {
    const pool = quotes[category] || [];
    if (pool.length === 0) return "";
    const usable = pool.filter((q) => neededPlaceholders(q).every((k) => ctx[k] != null && ctx[k] !== ""));
    const candidates = usable.length > 0 ? usable : pool;
    const key = `${category}:${candidates.length}`;
    let bag = bags[key];
    if (!bag || bag.length === 0) {
      bag = shuffle(candidates, rng);
      if (bag.length > 1 && bag[bag.length - 1] === last[category]) bag.unshift(bag.pop());
      bags[key] = bag;
    }
    const line = bag.pop();
    last[category] = line;
    return fillTemplate(line, ctx);
  };
}
