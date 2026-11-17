/**
 * @jest-environment node
 */
import fs from "fs";
import path from "path";
import {
  sanitizeDonationUrl,
  buildDonationLink,
  SUGGESTED_AMOUNTS,
  DEFAULT_AMOUNT,
} from "@/lib/donation";
import { FEATURES } from "@/lib/featureRegistry";

describe("donation config", () => {
  it("offers small-project style amounts with a default in the list", () => {
    expect(SUGGESTED_AMOUNTS).toEqual([3, 5, 10, 25]);
    expect(SUGGESTED_AMOUNTS).toContain(DEFAULT_AMOUNT);
  });

  it("registers a live donate feature", () => {
    const f = FEATURES.find((x) => x.id === "donate");
    expect(f).toMatchObject({ href: "/features/donate", status: "live", icon: "Coffee" });
  });
});

describe("sanitizeDonationUrl", () => {
  it.each([
    "https://paypal.me/your-name",
    "https://www.paypal.me/your-name",
    "https://www.paypal.com/donate/?hosted_button_id=ABC123",
  ])("accepts %s", (u) => {
    expect(sanitizeDonationUrl(u)).toBeTruthy();
  });

  it.each([
    ["empty", ""],
    ["undefined", undefined],
    ["number", 42],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["http (not https)", "http://paypal.me/your-name"],
    ["other host", "https://evil.example.com/paypal.me/x"],
    ["lookalike suffix", "https://paypal.me.evil.com/x"],
    ["lookalike prefix", "https://evilpaypal.me/x"],
    ["userinfo trick", "https://paypal.me@evil.com/x"],
    ["custom port", "https://paypal.me:8443/x"],
    ["not a url", "not a url"],
    ["too long", "https://paypal.me/" + "a".repeat(3000)],
  ])("rejects %s", (_n, u) => {
    expect(sanitizeDonationUrl(u)).toBe("");
  });
});

describe("buildDonationLink", () => {
  it("appends the amount to paypal.me links", () => {
    expect(buildDonationLink("https://paypal.me/your-name", 10)).toBe(
      "https://paypal.me/your-name/10USD"
    );
  });

  it("handles trailing slashes and strips query/hash for paypal.me", () => {
    expect(buildDonationLink("https://paypal.me/your-name/?x=1#y", 5)).toBe(
      "https://paypal.me/your-name/5USD"
    );
  });

  it("ignores amounts outside the suggested list (no URL injection)", () => {
    expect(buildDonationLink("https://paypal.me/your-name", "5/../../evil")).toBe(
      "https://paypal.me/your-name"
    );
    expect(buildDonationLink("https://paypal.me/your-name", 999999)).toBe(
      "https://paypal.me/your-name"
    );
  });

  it("leaves non-paypal.me links unchanged", () => {
    const u = "https://www.paypal.com/donate/?hosted_button_id=ABC123";
    expect(buildDonationLink(u, 5)).toBe(u);
  });

  it("returns empty string for unsafe input", () => {
    expect(buildDonationLink("javascript:alert(1)", 5)).toBe("");
    expect(buildDonationLink("", 5)).toBe("");
  });
});

describe("donate feature wiring (security/static checks)", () => {
  const root = path.join(__dirname, "..", "..");
  const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

  it("external link uses rel=noopener noreferrer", () => {
    expect(read("app/features/donate/DonateOptions.js")).toMatch(
      /rel="noopener noreferrer"/
    );
  });

  it("does not use dangerouslySetInnerHTML", () => {
    expect(read("app/features/donate/DonateOptions.js")).not.toMatch(
      /dangerouslySetInnerHTML/
    );
    expect(read("app/features/donate/page.js")).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("DONATION_URL is a non-secret runtime env var injected via Terraform", () => {
    expect(read("terraform/variables.tf")).toMatch(/variable "donation_url"/);
    expect(read("terraform/ecs.tf")).toMatch(/DONATION_URL.*var\.donation_url/);
    expect(read(".github/workflows/terraform.yml")).toMatch(
      /TF_VAR_donation_url: \$\{\{ secrets\.DONATION_URL \}\}/
    );
  });

  it("is not exposed to the browser bundle via NEXT_PUBLIC_", () => {
    expect(read("app/features/donate/page.js")).not.toMatch(/NEXT_PUBLIC_/);
  });
});
