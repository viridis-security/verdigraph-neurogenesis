// src/brainbuilder/storage.ts — persist BrainArtifacts to R2 + D1 index.

import type { Env } from "../index";
import type { BrainArtifact } from "./schema";

function r2Key(brain_id: string): string {
  return `brains/${brain_id}.json`;
}

export async function saveBrain(env: Env, brain: BrainArtifact, callerId: string | null, invariantsPassed: boolean): Promise<void> {
  const json = JSON.stringify(brain);
  await env.STATE_BUCKET.put(r2Key(brain.brain_id), json, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  const now = Date.now();
  // Upsert: brain_id is deterministic, so re-import of the same input is a no-op.
  await env.DB.prepare(
    `INSERT INTO brains (brain_id, caller_id, content_hash, input_format, input_sha256, input_bytes,
                          node_count, edge_count, agent_name, artifact_r2_key, invariants_passed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(brain_id) DO UPDATE SET
         caller_id         = COALESCE(brains.caller_id, excluded.caller_id),
         invariants_passed = excluded.invariants_passed`
  ).bind(
    brain.brain_id, callerId, brain.content_hash, brain.provenance.format,
    brain.provenance.input_sha256, brain.provenance.input_bytes,
    brain.nodes.length, brain.edges.length, brain.genome.agent_name,
    r2Key(brain.brain_id), invariantsPassed ? 1 : 0, now,
  ).run();
}

export async function loadBrain(env: Env, brain_id: string): Promise<BrainArtifact | null> {
  const obj = await env.STATE_BUCKET.get(r2Key(brain_id));
  if (!obj) return null;
  const text = await obj.text();
  return JSON.parse(text) as BrainArtifact;
}

export interface BrainIndexRow {
  brain_id: string; caller_id: string | null; content_hash: string;
  input_format: string; node_count: number; edge_count: number;
  agent_name: string; invariants_passed: number; created_at: number;
}

export async function getBrainIndex(env: Env, brain_id: string): Promise<BrainIndexRow | null> {
  return await env.DB.prepare(`SELECT brain_id, caller_id, content_hash, input_format, node_count, edge_count, agent_name, invariants_passed, created_at FROM brains WHERE brain_id = ?`).bind(brain_id).first<BrainIndexRow>();
}

/** Has any 'paid' or 'free' build been recorded for this brain? */
export async function isBrainUnlocked(env: Env, brain_id: string, callerId: string | null): Promise<{ unlocked: boolean; reason: string }> {
  const paid = await env.DB.prepare(
    `SELECT 1 FROM brain_builds WHERE brain_id = ? AND status IN ('paid','free') LIMIT 1`
  ).bind(brain_id).first<{ "1": number }>();
  if (paid) return { unlocked: true, reason: "build_paid_or_free" };
  // Subscription path: caller has an active unlimited_brains subscription.
  if (callerId) {
    const sub = await env.DB.prepare(
      `SELECT 1 FROM brain_builds WHERE caller_id = ? AND product = 'unlimited_brains' AND status = 'paid' LIMIT 1`
    ).bind(callerId).first<{ "1": number }>();
    if (sub) return { unlocked: true, reason: "unlimited_subscription" };
  }
  return { unlocked: false, reason: "payment_required" };
}
