// tests/brainbuilder/extractors.test.ts — extractor + invariant + reproducibility.
//
// These tests run in Vitest's default Node environment. They use globalThis.crypto
// (Node 20+) which exposes the WebCrypto API that the extractors rely on.

import { describe, it, expect } from "vitest";
import { extract, detectFormat } from "../../src/brainbuilder/extractors";
import { verifyBrain } from "../../src/brainbuilder/invariants";
import { BrainArtifactSchema } from "../../src/brainbuilder/schema";

const enc = (s: string) => new TextEncoder().encode(s);

describe("verdigraph_genome extractor", () => {
  const sample = JSON.stringify({
    agent_name: "research_assistant",
    purpose: "Help with literature reviews and synthesis.",
    initial_nodes: ["planner", "retriever", "summarizer"],
    fitness_metrics: ["task_success_rate"],
    llm_bindings: [{ provider: "anthropic", model_hint: "claude-sonnet-4-6" }],
  });

  it("produces a schema-valid brain", async () => {
    const brain = await extract("verdigraph_genome", enc(sample));
    expect(BrainArtifactSchema.safeParse(brain).success).toBe(true);
  });

  it("passes all invariants", async () => {
    const brain = await extract("verdigraph_genome", enc(sample));
    const report = await verifyBrain(brain);
    if (!report.passed) console.error(report.checks.filter((c) => !c.passed));
    expect(report.passed).toBe(true);
  });

  it("is deterministic — same input -> same content_hash and brain_id", async () => {
    const b1 = await extract("verdigraph_genome", enc(sample));
    const b2 = await extract("verdigraph_genome", enc(sample));
    expect(b1.brain_id).toBe(b2.brain_id);
    expect(b1.content_hash).toBe(b2.content_hash);
  });

  it("declares default llm_binding when input omits it", async () => {
    const minimal = JSON.stringify({
      agent_name: "x", purpose: "y",
      initial_nodes: ["a"], fitness_metrics: ["task_success_rate"],
    });
    const brain = await extract("verdigraph_genome", enc(minimal));
    expect(brain.genome.llm_bindings.length).toBeGreaterThan(0);
    expect(brain.provenance.warnings.some((w) => w.includes("llm_bindings"))).toBe(true);
  });
});

describe("claude_project_export extractor", () => {
  const sample = JSON.stringify({
    name: "code_reviewer",
    instructions: "Review code for security issues and style.",
    knowledge: [{ name: "team_style_guide", content: "Prefer const over let. No unused vars." }],
    tools:     [{ name: "run_tests", description: "Execute the test suite." }],
    model: "claude-sonnet-4-6",
  });

  it("produces a schema-valid brain with anthropic binding", async () => {
    const brain = await extract("claude_project_export", enc(sample));
    expect(BrainArtifactSchema.safeParse(brain).success).toBe(true);
    expect(brain.genome.llm_bindings[0]!.provider).toBe("anthropic");
  });

  it("passes invariants", async () => {
    const brain = await extract("claude_project_export", enc(sample));
    const report = await verifyBrain(brain);
    expect(report.passed).toBe(true);
  });
});

describe("openai_assistant extractor", () => {
  const sample = JSON.stringify({
    name: "data_helper",
    instructions: "Help with pandas dataframes.",
    model: "gpt-4o",
    tools: [
      { type: "code_interpreter" },
      { type: "function", function: { name: "lookup_schema", description: "Look up a table schema." } },
    ],
    file_ids: ["file_abc123"],
  });

  it("produces a schema-valid brain with openai binding", async () => {
    const brain = await extract("openai_assistant", enc(sample));
    expect(BrainArtifactSchema.safeParse(brain).success).toBe(true);
    expect(brain.genome.llm_bindings[0]!.provider).toBe("openai");
  });

  it("passes invariants", async () => {
    const brain = await extract("openai_assistant", enc(sample));
    const report = await verifyBrain(brain);
    expect(report.passed).toBe(true);
  });
});

describe("prompt_list extractor", () => {
  const prompts = [
    "You are a helpful assistant.",
    "Summarize the user's request.",
    "Plan steps and execute one at a time.",
    "Confirm completion with the user.",
  ];

  it("produces a schema-valid brain from a JSON list", async () => {
    const brain = await extract("prompt_list", enc(JSON.stringify(prompts)));
    expect(BrainArtifactSchema.safeParse(brain).success).toBe(true);
    expect(brain.nodes.length).toBeGreaterThanOrEqual(prompts.length);
  });

  it("produces a schema-valid brain from newline-separated text", async () => {
    const brain = await extract("prompt_list", enc(prompts.join("\n")));
    expect(BrainArtifactSchema.safeParse(brain).success).toBe(true);
    const report = await verifyBrain(brain);
    expect(report.passed).toBe(true);
  });

  it("is deterministic", async () => {
    const b1 = await extract("prompt_list", enc(prompts.join("\n")));
    const b2 = await extract("prompt_list", enc(prompts.join("\n")));
    expect(b1.content_hash).toBe(b2.content_hash);
  });
});

describe("auto-detect", () => {
  it("detects verdigraph_genome", () => {
    expect(detectFormat(enc(JSON.stringify({ agent_name: "x", initial_nodes: ["a"] })))).toBe("verdigraph_genome");
  });
  it("detects openai_assistant", () => {
    expect(detectFormat(enc(JSON.stringify({ tools: [{ type: "code_interpreter" }] })))).toBe("openai_assistant");
  });
  it("detects claude_project_export", () => {
    expect(detectFormat(enc(JSON.stringify({ instructions: "do x", knowledge: [] })))).toBe("claude_project_export");
  });
  it("falls back to prompt_list", () => {
    expect(detectFormat(enc("first prompt\nsecond prompt"))).toBe("prompt_list");
  });
});

describe("invariant failure modes", () => {
  it("rejects empty initial_nodes", async () => {
    const bad = JSON.stringify({ agent_name: "x", initial_nodes: [] });
    await expect(extract("verdigraph_genome", enc(bad))).rejects.toThrow();
  });
  it("rejects unparseable JSON", async () => {
    await expect(extract("verdigraph_genome", enc("{not json"))).rejects.toThrow();
  });
  it("detects tampered content_hash via verifyBrain", async () => {
    const brain = await extract("verdigraph_genome", enc(JSON.stringify({
      agent_name: "x", purpose: "y",
      initial_nodes: ["a"], fitness_metrics: ["task_success_rate"],
    })));
    const tampered = { ...brain, content_hash: "0".repeat(64) };
    const report = await verifyBrain(tampered as any);
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.id === "I5_content_hash")?.passed).toBe(false);
  });
});
