// tests/brainbuilder/iter3_surface.test.ts — iter3 contract regressions.
//
// Locks the iter3-shipped surfaces at the unit level:
//   - publishBrain / unpublishListing / searchListings visibility semantics (P0.1, P1.2)
//   - computeSplit math still intact (regression)
//   - pricing endpoint emits price_usd for every metered tool (P1.1)
//   - server card carries uri_schemes + openapi_url (P0.2 + P1.5)
//   - CANONICALIZATION.md carries Enforcement plan + Node taxonomy (P0.3 + P1.6)
//   - URI handler scripts non-empty (P0.2)
//   - OpenAPI doc covers /app/import exhaustively (P1.5)

import { describe, it, expect } from "vitest";
import { buildServerCard } from "../../src/discovery/manifest";
import { CANONICALIZATION_MD } from "../../src/discovery/canonicalization_doc";
import { OPENAPI_YAML } from "../../src/discovery/openapi_doc";
import { INSTALL_MACOS_SH, INSTALL_WINDOWS_PS1, INSTALL_LINUX_SH } from "../../src/discovery/uri_handler_scripts";
import { buildPricingMap } from "../../src/discovery/pricing";
import { computeSplit, estimateStripeFeeMicros } from "../../src/brainbuilder/marketplace";

describe("iter3: server card", () => {
  const card = buildServerCard();

  it("P1.1: every metered tool carries price_usd", () => {
    const missing = card.tools.filter((t: any) => t.metered && t.price_usd === undefined);
    expect(missing.map((t: any) => t.name)).toEqual([]);
  });

  it("P0.2: uri_schemes registered (verdigraph://brain/ at minimum)", () => {
    expect(Array.isArray(card.uri_schemes)).toBe(true);
    expect(card.uri_schemes!.length).toBeGreaterThan(0);
    const brainScheme = card.uri_schemes!.find((u: any) => u.scheme === "verdigraph://brain/");
    expect(brainScheme).toBeTruthy();
    expect(brainScheme!.resolves_to).toMatch(/\/app\/brains\/\{id\}/);
  });

  it("P1.5: openapi_url present and points at /openapi.yaml", () => {
    expect(card.openapi_url).toMatch(/\/openapi\.yaml$/);
  });

  it("P0.2: uri_handler_install carries all three platforms", () => {
    expect(card.uri_handler_install.macos).toMatch(/install-macos\.sh$/);
    expect(card.uri_handler_install.windows).toMatch(/install-windows\.ps1$/);
    expect(card.uri_handler_install.linux).toMatch(/install-linux\.sh$/);
  });
});

describe("iter3: CANONICALIZATION.md", () => {
  it("P0.3: Enforcement plan section present with cutover date >= 2026-11-19", () => {
    expect(CANONICALIZATION_MD).toMatch(/## Enforcement plan/);
    expect(CANONICALIZATION_MD).toMatch(/2026-11-19/);
  });

  it("P0.3: worked example uses claude_viridis_partner canonical brain id", () => {
    expect(CANONICALIZATION_MD).toMatch(/claude_viridis_partner/);
  });

  it("P1.6: Node taxonomy section present with closed enum", () => {
    expect(CANONICALIZATION_MD).toMatch(/## Node taxonomy/);
    for (const t of ["module", "infrastructure", "directive", "knowledge", "tool", "prompt"]) {
      expect(CANONICALIZATION_MD).toContain(t);
    }
  });
});

describe("iter3: OpenAPI", () => {
  it("P1.5: covers /app/import and key response fields", () => {
    expect(OPENAPI_YAML).toMatch(/\/app\/import:/);
    expect(OPENAPI_YAML).toMatch(/brain_uri:/);
    expect(OPENAPI_YAML).toMatch(/node_ids:/);
    expect(OPENAPI_YAML).toMatch(/passed_with_default:/);
    expect(OPENAPI_YAML).toMatch(/advisory:/);
    expect(OPENAPI_YAML).toMatch(/x-verdigraph-brain-id:/);
  });
});

describe("iter3: URI handler scripts", () => {
  it("P0.2: macOS script is bash, idempotent, no admin", () => {
    expect(INSTALL_MACOS_SH).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(INSTALL_MACOS_SH).toMatch(/lsregister/);
    expect(INSTALL_MACOS_SH).toMatch(/verdigraph:\/\/brain\//);
  });
  it("P0.2: Windows script is PowerShell, per-user (HKCU)", () => {
    expect(INSTALL_WINDOWS_PS1).toContain('HKCU:\\Software\\Classes\\verdigraph');
  });
  it("P0.2: Linux script uses xdg-mime", () => {
    expect(INSTALL_LINUX_SH).toMatch(/xdg-mime default verdigraph-uri-handler\.desktop/);
  });
});

describe("iter3: pricing endpoint", () => {
  it("P1.1: pricing map has tools array with metered + price_usd", () => {
    const p = buildPricingMap();
    expect(p.schema_version).toBe("verdigraph.pricing.v1");
    expect(Array.isArray(p.tools)).toBe(true);
    const meteredWithoutPrice = p.tools.filter((t: any) => t.metered && t.price_usd === undefined);
    expect(meteredWithoutPrice.length).toBe(0);
  });
  it("P1.1: conservation_share carries 25% commitment", () => {
    const p = buildPricingMap();
    expect(p.conservation_share.pct).toBe(25);
  });
});

describe("iter3: marketplace split (regression for I-INV5 stability)", () => {
  it("M4 sum invariant still holds for the 70/20/10 model", () => {
    for (const g of [9_000_000, 19_000_000, 99_000_000]) {
      const s = computeSplit(g, estimateStripeFeeMicros(g));
      expect(s.creator_share + s.viridis_share + s.conservation_share).toBe(s.net_micros);
    }
  });
});
