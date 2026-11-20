// Loads host definitions from public/hosts/: an index.json manifest plus one JSON file per host.
// Everything read from those files is validated here, so a typo skips one host instead of breaking the page.

import { isSafePlainObject } from "../objectGuard";
import { CLASSIC_LOOK, HEAD_STYLES, OUTFIT_STYLES, PALETTE_KEYS } from "./drawHost";
import { buildQuotes } from "./hostQuotes";

export const MANIFEST_URL = "/hosts/index.json";
export const HOST_STORAGE_KEY = "wheelHost";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SAFE_PATH_RE = /^\/[A-Za-z0-9._/-]+\.json$/;
const MAX_HOSTS = 12;
const MAX_NAME = 40;
const MAX_TAGLINE = 80;

// Last resort when no host file can be loaded, so the wheel still works.
export const FALLBACK_HOST = Object.freeze({
  id: "default",
  name: "Host",
  tagline: "",
  look: CLASSIC_LOOK,
  ...buildQuotes([]),
});

export function validateManifest(raw) {
  const problems = [];
  if (!isSafePlainObject(raw)) {
    return { ids: [], defaultId: null, sharedQuotes: null, problems: [`${MANIFEST_URL} is missing or not a JSON object`] };
  }

  const ids = [];
  for (const id of Array.isArray(raw.hosts) ? raw.hosts : []) {
    if (typeof id !== "string" || !ID_RE.test(id)) problems.push(`invalid host id ${JSON.stringify(id)} (use lowercase letters, digits and dashes)`);
    else if (ids.includes(id)) problems.push(`duplicate host id "${id}"`);
    else if (ids.length >= MAX_HOSTS) problems.push(`more than ${MAX_HOSTS} hosts; ignoring "${id}"`);
    else ids.push(id);
  }
  if (ids.length === 0) problems.push(`${MANIFEST_URL} lists no valid hosts`);

  let defaultId = ids[0] || null;
  if (raw.default != null) {
    if (ids.includes(raw.default)) defaultId = raw.default;
    else problems.push(`default host ${JSON.stringify(raw.default)} is not in "hosts"`);
  }

  let sharedQuotes = null;
  if (raw.sharedQuotes != null) {
    if (typeof raw.sharedQuotes === "string" && SAFE_PATH_RE.test(raw.sharedQuotes) && !raw.sharedQuotes.includes("..") && !raw.sharedQuotes.includes("//")) {
      sharedQuotes = raw.sharedQuotes;
    } else {
      problems.push(`sharedQuotes must be a same-site path ending in .json`);
    }
  }

  return { ids, defaultId, sharedQuotes, problems };
}

// Returns { host, problems }. `host` is null when the file cannot be used at all;
// smaller mistakes (bad color, unknown key) drop just that field and are reported.
export function validateHostFile(raw) {
  const problems = [];
  if (!isSafePlainObject(raw)) return { host: null, problems: ["file is missing or not a JSON object"] };

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) problems.push('"name" is required');
  else if (name.length > MAX_NAME) problems.push(`"name" is longer than ${MAX_NAME} characters`);

  const look = isSafePlainObject(raw.look) ? raw.look : null;
  if (!look) problems.push('"look" is required');
  else {
    if (!HEAD_STYLES.includes(look.head)) problems.push(`look.head must be one of: ${HEAD_STYLES.join(", ")}`);
    if (!OUTFIT_STYLES.includes(look.outfit)) problems.push(`look.outfit must be one of: ${OUTFIT_STYLES.join(", ")}`);
  }
  if (!name || name.length > MAX_NAME || !look || !HEAD_STYLES.includes(look.head) || !OUTFIT_STYLES.includes(look.outfit)) {
    return { host: null, problems };
  }

  const colors = {};
  if (look.colors != null) {
    if (!isSafePlainObject(look.colors)) problems.push("look.colors must be an object");
    else {
      for (const [key, value] of Object.entries(look.colors)) {
        if (!PALETTE_KEYS.includes(key)) problems.push(`look.colors.${key} is not a known color`);
        else if (typeof value !== "string" || !COLOR_RE.test(value)) problems.push(`look.colors.${key} must be a hex color like #1a2b3c`);
        else colors[key] = value;
      }
    }
  }

  let tagline = "";
  if (raw.tagline != null) {
    if (typeof raw.tagline === "string") tagline = raw.tagline.trim().slice(0, MAX_TAGLINE);
    else problems.push('"tagline" must be a string');
  }

  return { host: { name, tagline, look: { head: look.head, outfit: look.outfit, colors } }, problems };
}

async function fetchJson(fetchFn, url) {
  try {
    const res = await fetchFn(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Loads the manifest, the shared quotes and every listed host in parallel.
// Hosts that fail validation are skipped. Never throws; `problems` explains anything that was dropped.
export async function loadHosts(fetchFn = typeof fetch === "function" ? fetch : null) {
  if (!fetchFn) return { hosts: [FALLBACK_HOST], defaultId: FALLBACK_HOST.id, problems: ["fetch is unavailable"] };

  const manifest = validateManifest(await fetchJson(fetchFn, MANIFEST_URL));
  const problems = [...manifest.problems];
  if (manifest.ids.length === 0) return { hosts: [FALLBACK_HOST], defaultId: FALLBACK_HOST.id, problems };

  const [shared, ...files] = await Promise.all([
    manifest.sharedQuotes ? fetchJson(fetchFn, manifest.sharedQuotes) : null,
    ...manifest.ids.map((id) => fetchJson(fetchFn, `/hosts/${id}.json`)),
  ]);
  if (manifest.sharedQuotes && !shared) problems.push(`could not load shared quotes ${manifest.sharedQuotes}`);

  const hosts = [];
  manifest.ids.forEach((id, i) => {
    const { host, problems: found } = validateHostFile(files[i]);
    problems.push(...found.map((p) => `${id}.json: ${p}`));
    if (host) hosts.push({ id, ...host, ...buildQuotes([shared, files[i]]) });
  });

  if (hosts.length === 0) return { hosts: [FALLBACK_HOST], defaultId: FALLBACK_HOST.id, problems };
  const defaultId = hosts.some((h) => h.id === manifest.defaultId) ? manifest.defaultId : hosts[0].id;
  return { hosts, defaultId, problems };
}

export function pickHost(hosts, savedId, defaultId) {
  return hosts.find((h) => h.id === savedId) || hosts.find((h) => h.id === defaultId) || hosts[0] || FALLBACK_HOST;
}

export function readSavedHostId() {
  try {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(HOST_STORAGE_KEY) : null;
    return typeof saved === "string" && ID_RE.test(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function saveHostId(id) {
  try {
    window.localStorage.setItem(HOST_STORAGE_KEY, id);
  } catch {
    /* storage can be blocked; the choice just won't persist */
  }
}
