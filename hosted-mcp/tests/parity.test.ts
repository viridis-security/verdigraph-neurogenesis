// tests/parity.test.ts — cross-checks TypeScript ports against the Python reference.
//
// For each ported module, run the same input through Python and TypeScript and
// assert equivalence (within float tolerance for compute scoring). Python is invoked
// via child_process.spawnSync with stdin; if Python isn't available, skipped.

import { describe, expect, it } from "vitest";
import { spawnSync, execSync } from "node:child_process";
import { resolve } from "node:path";

import { chooseProfile, shouldUseCache, shouldEscalate, type ComputeProfile, type TaskProfile } from "../src/verdigraph/compute";
import { DevelopmentalAgent } from "../src/verdigraph/agent";
import { makeEvaluationResult } from "../src/verdigraph/evaluation";

const PROJECT_ROOT = resolve(__dirname, "..", "..");

function pythonAvailable(): boolean {
  try {
    execSync("python3 -c 'import verdigraph'", { cwd: PROJECT_ROOT, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a Python script that reads a JSON payload from stdin and writes JSON to stdout.
 * Avoids the quoting / JSON-literal pitfalls of inlining data through `python3 -c`.
 */
function runPython(script: string, payload: unknown): any {
  const r = spawnSync("python3", ["-c", script], {
    cwd: PROJECT_ROOT,
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`python failed: ${r.stderr}\n--- script ---\n${script}`);
  }
  return JSON.parse(r.stdout);
}

const PROFILES: ComputeProfile[] = [
  { id: "cache",   kind: "cache",     quality_score: 1.0,  cost_per_1k_input_tokens: 0,      cost_per_1k_output_tokens: 0,      latency_ms: 5,    gpu_memory_gb: 0, max_context_tokens: 4096, local: true,  metadata: {} },
  { id: "haiku",   kind: "api_model", quality_score: 0.78, cost_per_1k_input_tokens: 0.0008, cost_per_1k_output_tokens: 0.004,  latency_ms: 400,  gpu_memory_gb: 0, max_context_tokens: 200_000, local: false, metadata: {} },
  { id: "sonnet",  kind: "api_model", quality_score: 0.92, cost_per_1k_input_tokens: 0.003,  cost_per_1k_output_tokens: 0.015,  latency_ms: 900,  gpu_memory_gb: 0, max_context_tokens: 200_000, local: false, metadata: {} },
  { id: "opus",    kind: "api_model", quality_score: 0.98, cost_per_1k_input_tokens: 0.015,  cost_per_1k_output_tokens: 0.075,  latency_ms: 1800, gpu_memory_gb: 0, max_context_tokens: 200_000, local: false, metadata: {} },
];

const TASK_FIXTURES: Array<{ id: string; task: TaskProfile }> = [
  { id: "low_risk_summary", task: { id: "low_risk_summary", task_type: "summary", difficulty: 0.3, risk: 0.1, expected_input_tokens: 1000, expected_output_tokens: 200, min_quality: 0.7, requires_local: false, metadata: {} } },
  { id: "high_risk_code",   task: { id: "high_risk_code", task_type: "code_review", difficulty: 0.9, risk: 0.85, expected_input_tokens: 4000, expected_output_tokens: 1500, min_quality: 0.85, requires_local: false, metadata: {} } },
  { id: "local_required",   task: { id: "local_required", task_type: "redact", difficulty: 0.4, risk: 0.5, expected_input_tokens: 100, expected_output_tokens: 100, min_quality: 0.6, requires_local: true, metadata: {} } },
];

const havePython = pythonAvailable();

describe.skipIf(!havePython)("parity — chooseProfile vs Python ComputeOptimizer", () => {
  it.each(TASK_FIXTURES)("matches Python decision for $id", ({ task }) => {
    const tsDecision = chooseProfile(PROFILES, task);
    const script = `
import json, sys
from verdigraph.compute import ComputeOptimizer, ComputeProfile, TaskProfile
data = json.loads(sys.stdin.read())
profiles = [ComputeProfile(**p) for p in data['profiles']]
task = TaskProfile(**data['task'])
d = ComputeOptimizer(profiles).choose_profile(task)
print(json.dumps({'profile_id': d.profile_id, 'estimated_cost': d.estimated_cost}))
`;
    const py = runPython(script, { profiles: PROFILES, task });
    expect(tsDecision.profile_id).toBe(py.profile_id);
    expect(tsDecision.estimated_cost).toBeCloseTo(py.estimated_cost, 9);
  });
});

describe.skipIf(!havePython)("parity — should_use_cache / should_escalate", () => {
  const grid = [
    { c: 0.95, r: 0.2, threshold: 0.88 },
    { c: 0.9,  r: 0.8, threshold: 0.88 },
    { c: 0.5,  r: 0.6, threshold: 0.88 },
  ] as const;
  it.each(grid)("matches Python should_use_cache(c=$c r=$r)", ({ c, r, threshold }) => {
    const ts = shouldUseCache(c, r, threshold);
    const script = `
import json, sys
from verdigraph.compute import ComputeOptimizer
d = json.loads(sys.stdin.read())
print(json.dumps(ComputeOptimizer.should_use_cache(d['c'], d['r'], d['threshold'])))`;
    const py = runPython(script, { c, r, threshold });
    expect(ts).toBe(py);
  });
  const grid2 = [
    { c: 0.7, r: 0.2, min: 0.78 },
    { c: 0.9, r: 0.2, min: 0.78 },
    { c: 0.8, r: 0.9, min: 0.78 },
  ] as const;
  it.each(grid2)("matches Python should_escalate(c=$c r=$r)", ({ c, r, min }) => {
    const ts = shouldEscalate(c, r, min);
    const script = `
import json, sys
from verdigraph.compute import ComputeOptimizer
d = json.loads(sys.stdin.read())
print(json.dumps(ComputeOptimizer.should_escalate(d['c'], d['r'], d['min'])))`;
    const py = runPython(script, { c, r, min });
    expect(ts).toBe(py);
  });
});

describe.skipIf(!havePython)("parity — DevelopmentalAgent growth/pruning step", () => {
  it("evolves the graph identically for a fixed evaluation", () => {
    const genome = {
      agent_name: "parity-agent",
      purpose: "Cross-check Python vs TS evolution",
      initial_nodes: ["planner", "tool_router", "memory", "evaluation_engine"],
      fitness_metrics: ["success_rate"],
      metadata: {},
    };
    const ts = new DevelopmentalAgent(genome);
    ts.processEvaluation(makeEvaluationResult({
      task_id: "t1", task_type: "summarize", success_score: 0.85, safety_score: 0.95,
      used_edges: [["planner", "tool_router"]], used_nodes: ["planner"],
    }));
    const tsWeight = ts.graph.getEdge("planner", "tool_router")!.weight;

    const script = `
import json, sys
from verdigraph.agent import DevelopmentalAgent
from verdigraph.genome import AgentGenome
from verdigraph.evaluation import EvaluationResult
data = json.loads(sys.stdin.read())
g = AgentGenome.from_dict(data['genome'])
a = DevelopmentalAgent(g)
a.process_evaluation(EvaluationResult(
  task_id='t1', task_type='summarize', success_score=0.85, safety_score=0.95,
  used_edges=[('planner','tool_router')], used_nodes=['planner']
))
print(json.dumps({'weight': a.graph.get_edge('planner','tool_router').weight}))`;
    const py = runPython(script, { genome });
    expect(tsWeight).toBeCloseTo(py.weight, 9);
  });
});

// At least one always-on test so the file is meaningful when Python isn't available.
describe("parity — TS-only sanity", () => {
  it("PROFILES roster sanity", () => {
    expect(PROFILES.map((p) => p.id)).toEqual(["cache", "haiku", "sonnet", "opus"]);
  });
});
