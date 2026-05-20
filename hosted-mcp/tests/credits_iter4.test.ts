// tests/credits_iter4.test.ts — iter4 credit-purchase surface contract tests.

import { describe, it, expect } from "vitest";
import { newCreditCode } from "../src/billing/credit_codes";
import { buildServerCard } from "../src/discovery/manifest";
import { buildPricingMap } from "../src/discovery/pricing";

describe("iter4: credit codes", () => {
  it("C-INV5: code format is vdc_ + 24 Crockford-base32 chars", () => {
    for (let i = 0; i < 20; i++) {
      const code = newCreditCode();
      expect(code).toMatch(/^vdc_[0-9A-HJKMNP-TV-Z]{24}$/);
    }
  });
  it("C-INV5: codes are unique across many mints", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(newCreditCode());
    expect(seen.size).toBe(1000);
  });
});

describe("iter4: discovery surfaces credit tools", () => {
  const card = buildServerCard();
  const names = card.tools.map((t: any) => t.name);

  it("declares verdigraph_topup_url, verdigraph_redeem_credit_code, verdigraph_create_subscription", () => {
    expect(names).toContain("verdigraph_topup_url");
    expect(names).toContain("verdigraph_redeem_credit_code");
    expect(names).toContain("verdigraph_create_subscription");
  });

  it("all 3 new tools are free", () => {
    for (const n of ["verdigraph_topup_url", "verdigraph_redeem_credit_code", "verdigraph_create_subscription"]) {
      const t = card.tools.find((x: any) => x.name === n);
      expect(t).toBeTruthy();
      expect(t!.metered).toBe(false);
    }
  });
});

describe("iter4: pricing endpoint carries topup_url", () => {
  it("pricing map declares topup_url + subscription_default_usd", () => {
    const p = buildPricingMap();
    expect(p.topup_url).toBe("https://verdigraph.dev/credits");
    expect(p.subscription_default_usd).toBe(20);
  });
});
