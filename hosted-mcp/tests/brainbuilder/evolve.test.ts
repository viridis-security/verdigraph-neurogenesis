// tests/brainbuilder/evolve.test.ts — deterministic evolution + safety axioms.

import { describe, it, expect } from "vitest";
import { extract } from "../../src/brainbuilder/extractors";
import { evolveBrain } from "../../src/brainbuilder/evolve";
import { verifyBrain } from "../../src/brainbuilder/invariants";

const enc = (s: string) => new TextEncoder().encode(s);
const SAMPLE = JSON.stringify({
  agent_name: "x",
  purpose: "test",
  initial_nodes: ["planner", "executor"],
  fitness_metrics: ["task_success_rate"],
  llm_bindings: [{ provider: "any" }],
});

describe("evolveBrain", () => {
  it("strengthens an edge on success and keeps invariants", async () => {
    const brain = await extract("verdigraph_genome", enc(SAMPLE));
    const before = brain.edges.find((e) => e.from_node === "planner" && e.to_node === "safety_checker");
    expect(before).toBeTruthy();
    const { brain: evolved } = await evolveBrain(brain, [
      { from_node: "planner", to_node: "safety_checker", success: true },
      { from_node: "planner", to_node: "safety_checker", success: true },
    ]);
    const after = evolved.edges.find((e) => e.from_node === "planner" && e.to_node === "safety_checker")!;
    expect(after.weight).toBeGreaterThan(before!.weight);
    const report = await verifyBrain(evolved);
    expect(report.passed).toBe(true);
  });

  it("never prunes an edge whose endpoint is a protected node", async () => {
    const brain = await extract("verdigraph_genome", enc(SAMPLE));
    // Hammer with failures past the prune threshold + min events.
    const events = Array.from({ length: 30 }, () => ({
      from_node: "planner", to_node: "safety_checker", success: false,
    }));
    const { brain: evolved, growth_log } = await evolveBrain(brain, events);
    const stillThere = evolved.edges.find((e) => e.from_node === "planner" && e.to_node === "safety_checker");
    expect(stillThere).toBeTruthy();
    expect(growth_log.some((g) => g.event === "prune_blocked")).toBe(true);
    const report = await verifyBrain(evolved);
    expect(report.passed).toBe(true);
  });

  it("recomputes content_hash so verifyBrain stays green", async () => {
    const brain = await extract("verdigraph_genome", enc(SAMPLE));
    const { brain: evolved } = await evolveBrain(brain, [
      { from_node: "executor", to_node: "evaluation_engine", success: true },
    ]);
    expect(evolved.content_hash).not.toBe(brain.content_hash);
    const report = await verifyBrain(evolved);
    expect(report.passed).toBe(true);
  });

  it("grows a new module when a pattern repeats >= create_node_when_task_repeats", async () => {
    const brain = await extract("verdigraph_genome", enc(SAMPLE));
    const events = Array.from({ length: 5 }, () => ({
      from_node: "planner", to_node: "executor", success: true, pattern: "summarize_pdf",
    }));
    const { brain: evolved, growth_log } = await evolveBrain(brain, events);
    expect(growth_log.some((g) => g.event === "node_created" && g.detail.includes("summarize_pdf"))).toBe(true);
    expect(evolved.nodes.some((n) => n.id.includes("summarize_pdf"))).toBe(true);
    const report = await verifyBrain(evolved);
    expect(report.passed).toBe(true);
  });
});
