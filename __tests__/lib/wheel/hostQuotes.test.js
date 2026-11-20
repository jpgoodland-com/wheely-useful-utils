import fs from "fs";
import path from "path";
import {
  DEFAULT_QUOTES,
  KNOWN_PLACEHOLDERS,
  QUOTE_CATEGORIES,
  createQuotePicker,
  buildQuotes,
  fillTemplate,
  sanitizeQuotes,
} from "@/lib/wheel/hostQuotes";

describe("fillTemplate", () => {
  it("substitutes known placeholders and strips unknown ones", () => {
    expect(fillTemplate("I think {winner} will go again", { winner: "Adam" })).toBe("I think Adam will go again");
    expect(fillTemplate("Hi {bogus} there", {})).toBe("Hi there");
  });

  it("keeps HTML in names as inert text and truncates long names", () => {
    expect(fillTemplate("{winner}!", { winner: "<img src=x onerror=alert(1)>" })).toBe("<img src=x onerror=alert(1)>!");
    const out = fillTemplate("{winner}", { winner: "x".repeat(200) });
    expect(out.length).toBeLessThanOrEqual(40);
  });
});

describe("sanitizeQuotes / loadQuotes", () => {
  it("drops bad entries and falls back per category", () => {
    const out = sanitizeQuotes({ quotes: { result: ["ok", 5, "", null, "  spaced  "] }, bubbleMs: 99999 });
    expect(out.quotes.result).toEqual(["ok", "spaced"]);
    expect(out.quotes.error).toEqual(DEFAULT_QUOTES.error);
    expect(out.bubbleMs).toBe(8000);
  });

  it("merges files per category and skips anything that is not an object", () => {
    const out = buildQuotes([
      { quotes: { result: ["shared {winner}"], idle: ["shared idle"] }, bubbleMs: 3000 },
      null,
      "nope",
      { quotes: { result: ["own {winner}"] } },
    ]);
    expect(out.quotes.result).toEqual(["shared {winner}", "own {winner}"]);
    expect(out.quotes.idle).toEqual(["shared idle"]);
    expect(out.bubbleMs).toBe(3000);
  });

  it("lets a later file override bubbleMs", () => {
    expect(buildQuotes([{ bubbleMs: 3000 }, { bubbleMs: 5000 }]).bubbleMs).toBe(5000);
  });

  it("falls back to the built-in lines when nothing usable is given", () => {
    expect(buildQuotes([])).toEqual(sanitizeQuotes(null));
    expect(buildQuotes([null, 5])).toEqual(sanitizeQuotes(null));
    expect(buildQuotes(undefined).quotes.result).toEqual(DEFAULT_QUOTES.result);
  });
});

describe("createQuotePicker", () => {
  it("never repeats back to back and cycles through every line", () => {
    const pick = createQuotePicker({ result: ["a", "b", "c"] });
    const seen = [];
    for (let i = 0; i < 30; i++) seen.push(pick("result"));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(new Set(seen.slice(0, 3)).size).toBe(3);
  });

  it("skips lines whose placeholders have no value", () => {
    const pick = createQuotePicker({ result: ["{winner} wins", "Plain line"] });
    for (let i = 0; i < 10; i++) expect(pick("result", {})).toBe("Plain line");
  });
});

describe("public/hosts/shared-quotes.json", () => {
  const file = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "hosts", "shared-quotes.json"), "utf8"));

  it("has every category with lines that use only known placeholders", () => {
    for (const cat of QUOTE_CATEGORIES) {
      expect(Array.isArray(file.quotes[cat])).toBe(true);
      expect(file.quotes[cat].length).toBeGreaterThan(0);
      for (const line of file.quotes[cat]) {
        expect(typeof line).toBe("string");
        expect(line.length).toBeLessThanOrEqual(120);
        for (const m of line.matchAll(/\{(\w+)\}/g)) expect(KNOWN_PLACEHOLDERS).toContain(m[1]);
      }
    }
  });

  it("survives sanitizing unchanged", () => {
    const out = sanitizeQuotes(file);
    for (const cat of QUOTE_CATEGORIES) expect(out.quotes[cat]).toEqual(file.quotes[cat]);
  });
});
