// src/verdigraph/agent.ts — TS port of verdigraph/agent.py (DevelopmentalAgent).

import { hydrateGenome, AgentGenomeInputSchema, type AgentGenomeInput, type HydratedGenome } from "./genome";
import { CognitiveGraph, makeEdge, makeNode } from "./graph";
import { DevelopmentalLedger, type LedgerEvent } from "./dev_ledger";
import type { EvaluationResult } from "./evaluation";
import { GrowthEngine } from "./growth";
import { PruningEngine } from "./pruning";
import { Router } from "./routing";

export class DevelopmentalAgent {
  genome:  HydratedGenome;
  graph:   CognitiveGraph;
  ledger:  DevelopmentalLedger;
  growth:  GrowthEngine;
  pruning: PruningEngine;
  router:  Router;

  constructor(genome: AgentGenomeInput) {
    const parsed = AgentGenomeInputSchema.parse(genome);
    this.genome = hydrateGenome(parsed);
    this.graph  = DevelopmentalAgent.buildInitialGraph(this.genome);
    this.ledger = new DevelopmentalLedger();
    this.growth  = new GrowthEngine(this.genome, this.graph, this.ledger);
    this.pruning = new PruningEngine(this.genome, this.graph, this.ledger);
    this.router  = new Router(this.graph);
    this.ledger.record("agent_initialized", "Agent created from digital genome.", { agent_name: this.genome.agent_name });
  }

  static buildInitialGraph(genome: HydratedGenome): CognitiveGraph {
    const g = new CognitiveGraph();
    for (const id of genome.initial_nodes) {
      g.addNode(makeNode({ id, description: `Initial genome node: ${id}`, trust_score: 0.6 }));
    }
    for (let i = 0; i < genome.initial_nodes.length - 1; i++) {
      const src = genome.initial_nodes[i];
      const dst = genome.initial_nodes[i + 1];
      if (!src || !dst) continue;
      g.addEdge(makeEdge({ from_node: src, to_node: dst, weight: 0.5, trust_score: 0.6, plasticity: 0.5 }));
    }
    return g;
  }

  processEvaluation(result: EvaluationResult): void {
    this.growth.maybeGrowForTaskType(result.task_type);
    this.growth.reinforceFromEvaluation(result);
    this.pruning.weakenFromEvaluation(result);
    this.pruning.pruneLowValueEdges();
    this.enforceInvariants();
  }

  bestNextSteps(fromNode: string, limit = 3) {
    return this.router.bestNextSteps(fromNode, limit);
  }

  private enforceInvariants(): void {
    if (this.genome.safety_axioms.disallow_hidden_nodes) {
      for (const [id, node] of this.graph.nodes) {
        if (!node.description) throw new Error(`Invariant violation: node missing description: ${id}`);
      }
    }
    if (this.graph.nodes.size > this.genome.growth_rules.max_nodes) {
      throw new Error("Invariant violation: max_nodes exceeded");
    }
    if (this.graph.edges.size > this.genome.growth_rules.max_edges) {
      throw new Error("Invariant violation: max_edges exceeded");
    }
    for (const p of this.genome.safety_axioms.protected_nodes) {
      if (this.genome.initial_nodes.includes(p) && !this.graph.nodes.has(p)) {
        throw new Error(`Invariant violation: protected node removed: ${p}`);
      }
    }
  }

  toDict(): {
    genome: HydratedGenome;
    graph:  ReturnType<CognitiveGraph["toDict"]>;
    ledger: LedgerEvent[];
  } {
    return {
      genome: {
        agent_name:      this.genome.agent_name,
        purpose:         this.genome.purpose,
        initial_nodes:   [...this.genome.initial_nodes],
        fitness_metrics: [...this.genome.fitness_metrics],
        growth_rules:    { ...this.genome.growth_rules },
        safety_axioms:   {
          ...this.genome.safety_axioms,
          protected_nodes: [...this.genome.safety_axioms.protected_nodes],
          custom:          { ...this.genome.safety_axioms.custom },
        },
        metadata:        { ...this.genome.metadata },
      },
      graph:  this.graph.toDict(),
      ledger: this.ledger.toList(),
    };
  }

  static fromStateDict(state: { genome: AgentGenomeInput; graph: { nodes?: any; edges?: any }; ledger?: LedgerEvent[] }): DevelopmentalAgent {
    const agent = new DevelopmentalAgent(state.genome);
    agent.graph = CognitiveGraph.fromDict(state.graph);
    agent.growth.graph = agent.graph;
    agent.pruning.graph = agent.graph;
    agent.router.graph = agent.graph;
    agent.ledger.events = (state.ledger ?? []).map((e) => ({
      event_type: e.event_type,
      reason:     e.reason,
      payload:    { ...e.payload },
      timestamp:  e.timestamp,
    }));
    return agent;
  }
}
