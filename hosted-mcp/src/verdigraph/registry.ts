// src/verdigraph/registry.ts — per-caller Durable Object registry of developmental agents.
//
// One Durable Object instance per caller_id. The DO holds in-memory developmental
// agents and writes:
//   • lightweight index in DO storage (agent_id -> agent_name, node/edge/event counts)
//   • full state JSON snapshots to R2 at verdigraph-state/{caller_id}/{agent_id}.json
//
// Per-caller isolation is enforced structurally — the DO instance is keyed by
// callerId, and R2 keys are scoped under the callerId prefix. No tool can leak
// another caller's data because the DO never queries across callers.

import { DevelopmentalAgent } from "./agent";
import type { AgentGenome } from "./genome";

export interface AgentSummary {
  agent_id: string;
  agent_name: string;
  purpose: string;
  node_count: number;
  edge_count: number;
  ledger_events: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const SLUG_RE = /[^a-z0-9_-]+/g;
function slugify(name: string): string {
  const slug = name.trim().toLowerCase().replace(SLUG_RE, "-").replace(/^-+|-+$/g, "");
  return slug || "agent";
}

export interface RegistryDeps {
  callerId: string;
  bucket: R2Bucket;
  /** In-memory map keyed by agent_id for hot access. */
  inMemory: Map<string, DevelopmentalAgent>;
  /** Tombstones — soft-deleted agents (is_active=false). */
  tombstones: Set<string>;
}

export class CallerRegistry {
  constructor(private deps: RegistryDeps) {}

  private r2Key(agentId: string): string {
    return `${this.deps.callerId}/${agentId}.json`;
  }

  private allocateId(name: string): string {
    const base = slugify(name);
    if (!this.deps.inMemory.has(base) && !this.deps.tombstones.has(base)) return base;
    let i = 2;
    while (this.deps.inMemory.has(`${base}-${i}`) || this.deps.tombstones.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }

  async create(genome: AgentGenome): Promise<{ agentId: string; agent: DevelopmentalAgent }> {
    const agent = new DevelopmentalAgent(genome);
    const agentId = this.allocateId(agent.genome.agent_name);
    this.deps.inMemory.set(agentId, agent);
    this.deps.tombstones.delete(agentId);
    return { agentId, agent };
  }

  list(): AgentSummary[] {
    const out: AgentSummary[] = [];
    for (const [agentId, agent] of this.deps.inMemory) {
      out.push({
        agent_id:      agentId,
        agent_name:    agent.genome.agent_name,
        purpose:       agent.genome.purpose,
        node_count:    agent.graph.nodes.size,
        edge_count:    agent.graph.edges.size,
        ledger_events: agent.ledger.events.length,
        is_active:     !this.deps.tombstones.has(agentId),
        created_at:    agent.ledger.events[0]?.timestamp ?? "",
        updated_at:    agent.ledger.events[agent.ledger.events.length - 1]?.timestamp ?? "",
      });
    }
    return out;
  }

  get(agentId: string): DevelopmentalAgent {
    if (this.deps.tombstones.has(agentId)) {
      throw new Error(`Agent '${agentId}' has been deleted (soft).`);
    }
    const a = this.deps.inMemory.get(agentId);
    if (!a) throw new Error(`No agent registered with id '${agentId}' for this caller.`);
    return a;
  }

  /** Soft-delete: mark inactive, never hard-delete (per spec invariant). */
  softDelete(agentId: string): void {
    if (!this.deps.inMemory.has(agentId)) return;
    this.deps.tombstones.add(agentId);
    this.deps.inMemory.delete(agentId);
  }

  /** Snapshot the agent state to R2 under the caller's prefix. */
  async saveToR2(agentId: string): Promise<string> {
    const agent = this.get(agentId);
    const key = this.r2Key(agentId);
    const body = JSON.stringify(agent.toDict(), null, 2);
    await this.deps.bucket.put(key, body, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { caller_id: this.deps.callerId, agent_id: agentId },
    });
    return key;
  }

  /** Hydrate an agent state from R2. */
  async loadFromR2(agentId: string): Promise<DevelopmentalAgent> {
    const key = this.r2Key(agentId);
    const obj = await this.deps.bucket.get(key);
    if (!obj) throw new Error(`No R2 snapshot found at ${key}`);
    const text = await obj.text();
    const data = JSON.parse(text) as ReturnType<DevelopmentalAgent["toDict"]>;
    const agent = DevelopmentalAgent.fromStateDict(data);
    this.deps.inMemory.set(agentId, agent);
    this.deps.tombstones.delete(agentId);
    return agent;
  }
}
