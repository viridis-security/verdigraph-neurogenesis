// tests/brainbuilder/deterministic_pin.test.ts
//
// Lock the determinism contract: identical input bytes produce identical
// brain_id + content_hash. This is the regression net for I-INV1.
//
// The test does NOT pin a specific brain_id value because that would couple
// to the exact extractor defaults — instead it pins the property: two
// independent build passes from the same bytes must produce byte-identical
// brain_id and content_hash.

import { describe, it, expect } from "vitest";
import { extract } from "../../src/brainbuilder/extractors";
import { verifyBrain } from "../../src/brainbuilder/invariants";

const FIXTURES: Array<[string, string]> = [
  ["minimal verdigraph_genome", JSON.stringify({
    agent_name: "x", purpose: "y",
    initial_nodes: ["a"], fitness_metrics: ["task_success_rate"],
  })],
  ["with llm_bindings declared", JSON.stringify({
    agent_name: "claude_partner", purpose: "research assistant",
    initial_nodes: ["planner", "executor"],
    fitness_metrics: ["task_success_rate"],
    llm_bindings: [{ provider: "anthropic", model_hint: "claude-sonnet-4-6" }],
  })],
  ["with all six llm providers", JSON.stringify({
    agent_name: "polyglot", purpose: "polyglot",
    initial_nodes: ["a", "b"], fitness_metrics: ["task_success_rate"],
    llm_bindings: [
      { provider: "anthropic" }, { provider: "openai" }, { provider: "google" },
      { provider: "mistral" }, { provider: "local" }, { provider: "any" },
    ],
  })],
];

describe("deterministic_pin (I-INV1)", () => {
  for (const [name, body] of FIXTURES) {
    it(`${name}: 5 rebuilds produce identical brain_id+content_hash`, async () => {
      const bytes = new TextEncoder().encode(body);
      const out = [];
      for (let i = 0; i < 5; i++) {
        const brain = await extract("verdigraph_genome", bytes);
        out.push({ id: brain.brain_id, hash: brain.content_hash });
      }
      const ref = out[0]!;
      for (const r of out) {
        expect(r.id).toBe(ref.id);
        expect(r.hash).toBe(ref.hash);
      }
      expect(ref.id).toMatch(/^[A-Z0-9]{26}$/);
      expect(ref.hash).toMatch(/^[0-9a-f]{64}$/);
    });
  }

  it("byte-level diff breaks the id (sensitivity)", async () => {
    const b1 = await extract("verdigraph_genome", new TextEncoder().encode(FIXTURES[0]![1]));
    const tampered = FIXTURES[0]![1].replace('"a"', '"a "'); // one trailing space inside the genome
    const b2 = await extract("verdigraph_genome", new TextEncoder().encode(tampered));
    expect(b1.brain_id).not.toBe(b2.brain_id);
    expect(b1.content_hash).not.toBe(b2.content_hash);
  });

  it("brain_uri presentation form is derivable from brain_id (P1.7-additive)", async () => {
    const brain = await extract("verdigraph_genome", new TextEncoder().encode(FIXTURES[0]![1]));
    const uri = "verdigraph://brain/" + brain.brain_id;
    expect(uri).toMatch(/^verdigraph:\/\/brain\/[A-Z0-9]{26}$/);
  });

  it("advisory I9 doesn't drop overall passed", async () => {
    // A genome with an unwired fitness metric — I9 fails, overall stays true.
    const genome = JSON.stringify({
      agent_name: "unwired", purpose: "y",
      initial_nodes: ["a"],
      fitness_metrics: ["a_metric_that_no_node_mentions_at_all_xyz123"],
      llm_bindings: [{ provider: "any" }],
    });
    const brain = await extract("verdigraph_genome", new TextEncoder().encode(genome));
    const report = await verifyBrain(brain);
    const i9 = report.checks.find((c) => c.id === "I9_fitness_metric_wired");
    expect(i9).toBeTruthy();
    expect(i9!.advisory).toBe(true);
    expect(i9!.passed).toBe(false);
    expect(report.passed).toBe(true);
  });

  it("I8 passed_with_default fires when llm_bindings auto-defaulted", async () => {
    // Omit llm_bindings — extractor adds one with provider=any and emits a warning.
    const genome = JSON.stringify({
      agent_name: "no_bindings", purpose: "y",
      initial_nodes: ["a"], fitness_metrics: ["task_success_rate"],
    });
    const brain = await extract("verdigraph_genome", new TextEncoder().encode(genome));
    const report = await verifyBrain(brain);
    const i8 = report.checks.find((c) => c.id === "I8_llm_bindings");
    expect(i8).toBeTruthy();
    expect(i8!.passed).toBe(true);
    expect(i8!.passed_with_default).toBe(true);
  });
});
