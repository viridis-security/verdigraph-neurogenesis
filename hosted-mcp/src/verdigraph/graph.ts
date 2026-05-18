// src/verdigraph/graph.ts — TS port of verdigraph/graph.py.
//
// CognitiveGraph holds nodes + (from,to)-keyed edges. Designed to be JSON-roundtrippable
// so the DO snapshot is identical in shape to the Python verdigraph state files.

export function utcNow(): string {
  return new Date().toISOString();
}

// ── Nodes ───────────────────────────────────────────────────────────────
export interface CognitiveNode {
  id: string;
  type: string;
  description: string;
  status: string;             // 'active' | 'archived' | ...
  trust_score: number;
  usage_count: number;
  success_count: number;
  failure_count: number;
  created_at: string;
  metadata: Record<string, unknown>;
}

export function makeNode(init: Partial<CognitiveNode> & { id: string }): CognitiveNode {
  return {
    id:            init.id,
    type:          init.type          ?? "module",
    description:   init.description   ?? "",
    status:        init.status        ?? "active",
    trust_score:   init.trust_score   ?? 0.5,
    usage_count:   init.usage_count   ?? 0,
    success_count: init.success_count ?? 0,
    failure_count: init.failure_count ?? 0,
    created_at:    init.created_at    ?? utcNow(),
    metadata:      init.metadata      ?? {},
  };
}

export function nodeSuccessRate(n: CognitiveNode): number {
  const total = n.success_count + n.failure_count;
  return total === 0 ? 0 : n.success_count / total;
}

// ── Edges ───────────────────────────────────────────────────────────────
export interface CognitiveEdge {
  from_node: string;
  to_node:   string;
  weight:    number;
  plasticity: number;
  trust_score: number;
  success_count: number;
  failure_count: number;
  token_cost: number;
  latency_ms: number;
  risk_score: number;
  decay_rate: number;
  last_used: string;
  metadata: Record<string, unknown>;
}

export function makeEdge(init: Partial<CognitiveEdge> & { from_node: string; to_node: string }): CognitiveEdge {
  const e: CognitiveEdge = {
    from_node:     init.from_node,
    to_node:       init.to_node,
    weight:        init.weight        ?? 0.5,
    plasticity:    init.plasticity    ?? 0.5,
    trust_score:   init.trust_score   ?? 0.5,
    success_count: init.success_count ?? 0,
    failure_count: init.failure_count ?? 0,
    token_cost:    init.token_cost    ?? 1.0,
    latency_ms:    init.latency_ms    ?? 1.0,
    risk_score:    init.risk_score    ?? 1.0,
    decay_rate:    init.decay_rate    ?? 0.01,
    last_used:     init.last_used     ?? utcNow(),
    metadata:      init.metadata      ?? {},
  };
  clampEdge(e);
  return e;
}

export function edgeId(e: CognitiveEdge): string {
  return `${e.from_node}->${e.to_node}`;
}

export function edgeSuccessRate(e: CognitiveEdge): number {
  const total = e.success_count + e.failure_count;
  return total === 0 ? 0 : e.success_count / total;
}

export function clampEdge(e: CognitiveEdge, minWeight = 0, maxWeight = 1): void {
  e.weight      = Math.max(minWeight, Math.min(maxWeight, e.weight));
  e.trust_score = Math.max(0, Math.min(1, e.trust_score));
  e.plasticity  = Math.max(0, Math.min(1, e.plasticity));
}

// ── Graph ───────────────────────────────────────────────────────────────
export class CognitiveGraph {
  nodes: Map<string, CognitiveNode> = new Map();
  /** edges keyed by canonical "from->to" composite key */
  private _edges: Map<string, CognitiveEdge> = new Map();

  static edgeKey(from: string, to: string): string {
    return `${from}${to}`;
  }

  get edges(): Map<string, CognitiveEdge> { return this._edges; }

  addNode(node: CognitiveNode): void {
    if (this.nodes.has(node.id)) throw new Error(`Node already exists: ${node.id}`);
    this.nodes.set(node.id, node);
  }

  addEdge(edge: CognitiveEdge): void {
    if (!this.nodes.has(edge.from_node)) throw new Error(`Missing from_node: ${edge.from_node}`);
    if (!this.nodes.has(edge.to_node))   throw new Error(`Missing to_node: ${edge.to_node}`);
    const key = CognitiveGraph.edgeKey(edge.from_node, edge.to_node);
    if (this._edges.has(key)) throw new Error(`Edge already exists: ${edgeId(edge)}`);
    clampEdge(edge);
    this._edges.set(key, edge);
  }

  getEdge(from: string, to: string): CognitiveEdge | undefined {
    return this._edges.get(CognitiveGraph.edgeKey(from, to));
  }

  removeEdge(from: string, to: string): void {
    this._edges.delete(CognitiveGraph.edgeKey(from, to));
  }

  removeNode(id: string): void {
    if (!this.nodes.has(id)) return;
    this.nodes.delete(id);
    for (const key of [...this._edges.keys()]) {
      const e = this._edges.get(key)!;
      if (e.from_node === id || e.to_node === id) this._edges.delete(key);
    }
  }

  outgoing(id: string): CognitiveEdge[] {
    return [...this._edges.values()].filter((e) => e.from_node === id);
  }

  incoming(id: string): CognitiveEdge[] {
    return [...this._edges.values()].filter((e) => e.to_node === id);
  }

  routeCandidates(startNodes: Iterable<string>): CognitiveEdge[] {
    const out: CognitiveEdge[] = [];
    for (const n of startNodes) out.push(...this.outgoing(n));
    return out.sort((a, b) => b.weight * b.trust_score - a.weight * a.trust_score);
  }

  toDict(): { nodes: Record<string, CognitiveNode>; edges: Record<string, CognitiveEdge> } {
    const nodes: Record<string, CognitiveNode> = {};
    for (const [id, n] of this.nodes) nodes[id] = n;
    const edges: Record<string, CognitiveEdge> = {};
    for (const e of this._edges.values()) edges[edgeId(e)] = e;
    return { nodes, edges };
  }

  static fromDict(data: { nodes?: Record<string, CognitiveNode>; edges?: Record<string, CognitiveEdge> }): CognitiveGraph {
    const g = new CognitiveGraph();
    for (const nd of Object.values(data.nodes ?? {})) g.addNode(makeNode(nd));
    for (const ed of Object.values(data.edges ?? {})) g.addEdge(makeEdge(ed));
    return g;
  }
}
