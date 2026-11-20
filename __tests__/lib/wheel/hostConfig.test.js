/** @jest-environment jsdom */
import fs from "fs";
import path from "path";
import { HEAD_STYLES, OUTFIT_STYLES, PALETTE_KEYS, drawHost, HOST_W, HOST_H } from "@/lib/wheel/drawHost";
import { KNOWN_PLACEHOLDERS, QUOTE_CATEGORIES } from "@/lib/wheel/hostQuotes";
import { NEUTRAL_POSE } from "@/lib/wheel/hostPoses";
import {
  FALLBACK_HOST,
  loadHosts,
  pickHost,
  readSavedHostId,
  validateHostFile,
  validateManifest,
} from "@/lib/wheel/hostConfig";

const publicDir = path.join(process.cwd(), "public");
const readPublic = (url) => JSON.parse(fs.readFileSync(path.join(publicDir, url), "utf8"));
const serve = (files) => async (url) => (url in files ? { ok: true, json: async () => files[url] } : { ok: false });

const goodHost = (over = {}) => ({
  name: "Test",
  tagline: "A tester",
  look: { head: "bald", outfit: "suit", colors: { skin: "#fff" } },
  quotes: { result: ["{winner} wins"] },
  ...over,
});

describe("validateManifest", () => {
  it("accepts a good manifest", () => {
    const out = validateManifest({ default: "b", hosts: ["a", "b"], sharedQuotes: "/hosts/shared-quotes.json" });
    expect(out).toEqual({ ids: ["a", "b"], defaultId: "b", sharedQuotes: "/hosts/shared-quotes.json", problems: [] });
  });

  it("defaults to the first host and reports an unknown default", () => {
    const out = validateManifest({ default: "zzz", hosts: ["a", "b"] });
    expect(out.defaultId).toBe("a");
    expect(out.problems.join()).toMatch(/default host/);
  });

  it("drops invalid, duplicate and excess ids", () => {
    const out = validateManifest({ hosts: ["ok", "../etc/passwd", "Bad Id", 5, "ok", ...Array.from({ length: 20 }, (_, i) => `h${i}`)] });
    expect(out.ids).toHaveLength(12);
    expect(out.ids[0]).toBe("ok");
    expect(out.ids).not.toContain("../etc/passwd");
    expect(out.problems.length).toBeGreaterThanOrEqual(4);
  });

  it("only allows same-site .json paths for shared quotes", () => {
    for (const bad of ["https://evil.example/x.json", "//evil.example/x.json", "/hosts/../secret.json", "/x.js", "x.json", 5]) {
      expect(validateManifest({ hosts: ["a"], sharedQuotes: bad }).sharedQuotes).toBeNull();
    }
  });

  it("copes with junk", () => {
    for (const junk of [null, undefined, "x", [], 5, JSON.parse('{"__proto__": {"x": 1}}')]) {
      expect(validateManifest(junk).ids).toEqual([]);
    }
  });
});

describe("validateHostFile", () => {
  it("accepts a good host and keeps only valid colors", () => {
    const { host, problems } = validateHostFile(
      goodHost({ look: { head: "fox", outfit: "trail", colors: { skin: "#f08a24", vest: "red", bogus: "#000", shoe: "#abc" } } })
    );
    expect(host.look.colors).toEqual({ skin: "#f08a24", shoe: "#abc" });
    expect(problems).toHaveLength(2);
  });

  it("rejects hosts that cannot be drawn", () => {
    expect(validateHostFile(goodHost({ name: "" })).host).toBeNull();
    expect(validateHostFile(goodHost({ name: "x".repeat(41) })).host).toBeNull();
    expect(validateHostFile(goodHost({ look: { head: "dragon", outfit: "suit" } })).host).toBeNull();
    expect(validateHostFile(goodHost({ look: { head: "bald", outfit: "spacesuit" } })).host).toBeNull();
    expect(validateHostFile(goodHost({ look: undefined })).host).toBeNull();
    expect(validateHostFile(null).host).toBeNull();
    expect(validateHostFile([]).host).toBeNull();
  });

  it("names the valid options in the error", () => {
    const { problems } = validateHostFile(goodHost({ look: { head: "dragon", outfit: "suit" } }));
    expect(problems.join()).toContain(HEAD_STYLES.join(", "));
  });

  it("rejects prototype-polluting keys", () => {
    expect(validateHostFile(JSON.parse('{"__proto__": {"x": 1}, "name": "A"}')).host).toBeNull();
    const out = validateHostFile(goodHost({ look: JSON.parse('{"head":"bald","outfit":"suit","colors":{"constructor":"#fff"}}') }));
    expect(out.host.look.colors).toEqual({});
  });
});

describe("loadHosts", () => {
  const files = {
    "/hosts/index.json": { default: "b", hosts: ["a", "b", "broken", "missing"], sharedQuotes: "/hosts/shared.json" },
    "/hosts/shared.json": { quotes: { result: ["shared {winner}"], idle: ["shared idle"] }, bubbleMs: 3000 },
    "/hosts/a.json": goodHost({ name: "Alpha" }),
    "/hosts/b.json": goodHost({ name: "Beta", quotes: { result: ["beta {winner}"] } }),
    "/hosts/broken.json": goodHost({ look: { head: "dragon", outfit: "suit" } }),
  };

  it("loads valid hosts, skips broken or missing ones and reports why", async () => {
    const out = await loadHosts(serve(files));
    expect(out.hosts.map((h) => h.id)).toEqual(["a", "b"]);
    expect(out.defaultId).toBe("b");
    expect(out.problems.join("\n")).toMatch(/broken\.json/);
    expect(out.problems.join("\n")).toMatch(/missing\.json/);
  });

  it("layers each host's quotes on the shared ones", async () => {
    const { hosts } = await loadHosts(serve(files));
    const beta = hosts.find((h) => h.id === "b");
    expect(beta.quotes.result).toEqual(["shared {winner}", "beta {winner}"]);
    expect(beta.quotes.idle).toEqual(["shared idle"]);
    expect(beta.bubbleMs).toBe(3000);
  });

  it("still loads hosts when the shared quotes are missing", async () => {
    const { hosts, problems } = await loadHosts(serve({ ...files, "/hosts/shared.json": undefined, "/hosts/index.json": { hosts: ["a"], sharedQuotes: "/hosts/shared.json" } }));
    expect(hosts.map((h) => h.id)).toEqual(["a"]);
    expect(problems.join()).toMatch(/shared quotes/);
  });

  it("falls back to the classic host when nothing loads", async () => {
    for (const fetchFn of [serve({}), async () => { throw new Error("offline"); }, null]) {
      const out = await loadHosts(fetchFn);
      expect(out.hosts).toEqual([FALLBACK_HOST]);
      expect(out.defaultId).toBe(FALLBACK_HOST.id);
      expect(out.problems.length).toBeGreaterThan(0);
    }
  });

  it("falls back when every listed host is invalid", async () => {
    const out = await loadHosts(serve({ "/hosts/index.json": { hosts: ["a"] }, "/hosts/a.json": { name: "" } }));
    expect(out.hosts).toEqual([FALLBACK_HOST]);
  });
});

describe("pickHost / saved choice", () => {
  const hosts = [{ id: "a" }, { id: "b" }];
  it("prefers the saved host, then the default, then the first", () => {
    expect(pickHost(hosts, "b", "a").id).toBe("b");
    expect(pickHost(hosts, "gone", "b").id).toBe("b");
    expect(pickHost(hosts, null, "gone").id).toBe("a");
    expect(pickHost([], "x", "y")).toBe(FALLBACK_HOST);
  });

  it("ignores a tampered saved value", () => {
    window.localStorage.setItem("wheelHost", "<img onerror=x>");
    expect(readSavedHostId()).toBeNull();
    window.localStorage.setItem("wheelHost", "fox");
    expect(readSavedHostId()).toBe("fox");
    window.localStorage.clear();
  });
});

describe("the hosts shipped in public/hosts", () => {
  const manifest = readPublic("hosts/index.json");

  it("has a valid manifest that defaults to Ace", () => {
    const out = validateManifest(manifest);
    expect(out.problems).toEqual([]);
    expect(out.defaultId).toBe("ace");
    expect(out.ids).toEqual(expect.arrayContaining(["ace", "fox", "chip"]));
  });

  it.each(manifest.hosts)("%s.json validates with no problems, covers every quote category and draws", (id) => {
    const raw = readPublic(`hosts/${id}.json`);
    const { host, problems } = validateHostFile(raw);
    expect(problems).toEqual([]);
    expect(host).not.toBeNull();
    expect(Object.keys(host.look.colors).every((k) => PALETTE_KEYS.includes(k))).toBe(true);
    expect(OUTFIT_STYLES).toContain(host.look.outfit);

    const shared = readPublic("hosts/shared-quotes.json");
    for (const cat of QUOTE_CATEGORIES) {
      expect((shared.quotes[cat] || []).length + (raw.quotes[cat] || []).length).toBeGreaterThan(0);
    }
    for (const lines of Object.values(raw.quotes)) {
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(120);
        for (const m of line.matchAll(/\{(\w+)\}/g)) expect(KNOWN_PLACEHOLDERS).toContain(m[1]);
      }
    }

    const calls = [];
    const ctx = new Proxy({}, { get: (t, k) => (k === "canvas" ? {} : (...a) => calls.push([k, a])), set: () => true });
    drawHost(ctx, { ...NEUTRAL_POSE }, { facing: -1, look: host.look });
    expect(calls.filter(([k]) => k === "fillRect").length).toBeGreaterThan(20);
    expect(HOST_W * HOST_H).toBeGreaterThan(0);
  });

  it("loads end to end through loadHosts exactly as the browser would", async () => {
    const fetchFn = async (url) => ({ ok: true, json: async () => readPublic(url.replace(/^\//, "")) });
    const out = await loadHosts(fetchFn);
    expect(out.problems).toEqual([]);
    expect(out.defaultId).toBe("ace");
    expect(out.hosts.map((h) => h.id)).toEqual(manifest.hosts);
    for (const h of out.hosts) for (const cat of QUOTE_CATEGORIES) expect(h.quotes[cat].length).toBeGreaterThan(0);
  });
});
