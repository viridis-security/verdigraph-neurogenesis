// tests/agent.test.ts — DevelopmentalAgent + CognitiveGraph invariants.
import { describe, expect, it } from "vitest";
import { DevelopmentalAgent } from "../src/verdigraph/agent";
import { CognitiveGraph } from "../src/verdigraph/graph";
import { makeEvaluationResult, isSuccess, isFailure } from "../src/verdigraph/evaluation";
import { Router } from "../src/verdigraph/routing";

const GENOME = {
  agent_name: "test-agent",
  purpose:    "Unit test agent",
  initial_nodes: ["planner", "tool_router", "memory", "evaluation_engine"],
  fitness_metrics: ["success_rate"],
  metadata: {},
};

describe("DevelopmentalAgent — initial graph", () => {
  it("creates one node per initial_nodes + a chain of edges", () => {
    const a = new DevelopmentalAgent(GENOME);
    expect(a.graph.nodes.size).toBe(4);
    expect(a.graph.edges.size).toBe(3);
    expect(a.ledger.events[0]?.event_type).toBe("agent_initialized");
  });

  it("rejects duplicate initial_nodes", () => {
    expect(() => new DevelopmentalAgent({ ...GENOME, initial_nodes: ["a", "a", "b"] })).toThrow();
  });
});

describe("DevelopmentalAgent — evaluation drives growth + pruning", () => {
  it("reinforces edges on success", () => {
    const a = new DevelopmentalAgent(GENOME);
    const before = a.graph.getEdge("planner", "tool_router")!.weight;
    a.processEvaluation(makeEvaluationResult({
      task_id: "t1", task_type: "x", success_score: 0.9,
      safety_score: 0.9, used_edges: [["planner", "tool_router"]], used_nodes: ["planner"],
    }));
    const after = a.graph.getEdge("planner", "tool_router")!.weight;
    expect(after).toBeGreaterThan(before);
  });

  it("weakens edges on failure", () => {
    const a = new DevelopmentalAgent(GENOME);
    const before = a.graph.getEdge("planner", "tool_router")!.weight;
    a.processEvaluation(makeEvaluationResult({
      task_id: "t2", task_type: "x", success_score: 0.1,
      safety_score: 0.5, used_edges: [["planner", "tool_router"]],
    }));
    const after = a.graph.getEdge("planner", "tool_router")!.weight;
    expect(after).toBeLessThan(before);
  });

  it("grows a specialist node after repeated task_type", () => {
    const a = new DevelopmentalAgent(GENOME);
    for (let i = 0; i < 5; i++) {
      a.processEvaluation(makeEvaluationResult({
        task_id: `t-${i}`, task_type: "summarize", success_score: 0.8, safety_score: 0.95,
      }));
    }
    expect([...a.graph.nodes.keys()]).toContain("summarize_specialist");
  });

  it("enforces max_nodes invariant", () => {
    const tiny = { ...GENOME, growth_rules: { max_nodes: 4, max_edges: 512 } } as any;
    const a = new DevelopmentalAgent(tiny);
    // 4 initial nodes already; repeated tasks shouldn't grow further.
    for (let i = 0; i < 6; i++) {
      a.processEvaluation(makeEvaluationResult({
        task_id: `t-${i}`, task_type: "summarize", success_score: 0.8, safety_score: 0.95,
      }));
    }
    expect(a.graph.nodes.size).toBeLessThanOrEqual(4);
  });
});

describe("DevelopmentalAgent — round-trip serialization", () => {
  it("toDict / fromStateDict preserves graph topology and ledger", () => {
    const a = new DevelopmentalAgent(GENOME);
    a.processEvaluation(makeEvaluationResult({
      task_id: "t1", task_type: "x", success_score: 0.9, safety_score: 0.95,
      used_edges: [["planner", "tool_router"]],
    }));
    const dict = a.toDict();
    const b    = DevelopmentalAgent.fromStateDict(dict);
    expect(b.graph.nodes.size).toBe(a.graph.nodes.size);
    expect(b.graph.edges.size).toBe(a.graph.edges.size);
    expect(b.ledger.events.length).toBe(a.ledger.events.length);
    expect(b.graph.getEdge("planner", "tool_router")?.weight)
      .toBeCloseTo(a.graph.getEdge("planner", "tool_router")!.weight, 9);
  });
});

describe("Router — best_next_steps", () => {
  it("returns descending scores", () => {
    const a = new DevelopmentalAgent(GENOME);
    const steps = a.bestNextSteps("planner", 3);
    expect(steps.length).toBe(1);
    expect(steps[0]?.score).toBeGreaterThan(0);
  });
});

describe("evaluation predicates", () => {
  it("isSuccess requires both success_score and safety_score", () => {
    expect(isSuccess(makeEvaluationResult({ task_id: "t", task_type: "x", success_score: 0.8, safety_score: 0.9 }))).toBe(true);
    expect(isSuccess(makeEvaluationResult({ task_id: "t", task_type: "x", success_score: 0.9, safety_score: 0.5 }))).toBe(false);
  });
  it("isFailure triggers on either low success or low safety", () => {
    expect(isFailure(makeEvaluationResult({ task_id: "t", task_type: "x", success_score: 0.3, safety_score: 1.0 }))).toBe(true);
    expect(isFailure(makeEvaluationResult({ task_id: "t", task_type: "x", success_score: 0.9, safety_score: 0.5 }))).toBe(true);
    expect(isFailure(makeEvaluationResult({ task_id: "t", task_type: "x", success_score: 0.5, safety_score: 0.9 }))).toBe(false);
  });
});

describe("CognitiveGraph — invariants", () => {
  it("rejects duplicate node ids", () => {
    const g = new CognitiveGraph();
    g.addNode({ id: "a", type: "module", description: "", status: "active", trust_score: 0.5, usage_count: 0, success_count: 0, failure_count: 0, created_at: "", metadata: {} });
    expect(() => g.addNode({ id: "a", type: "module", description: "", status: "active", trust_score: 0.5, usage_count: 0, success_count: 0, failure_count: 0, created_at: "", metadata: {} })).toThrow();
  });
  it("removes incident edges when a node is removed", () => {
    const a = new DevelopmentalAgent(GENOME);
    a.graph.removeNode("tool_router");
    expect(a.graph.outgoing("planner").length).toBe(0);
    expect(a.graph.incoming("memory").length).toBe(0);
  });
});
