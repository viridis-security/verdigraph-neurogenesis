# Architecture

## Data flow

```text
Genome JSON
   ↓
DevelopmentalAgent
   ↓
CognitiveGraph + DevelopmentalLedger
   ↓
EvaluationResult events
   ↓
GrowthEngine + PruningEngine
   ↓
Evolved state JSON
```

## Main classes

- `AgentGenome`: immutable developmental specification.
- `GrowthRules`: numerical bounds for development.
- `SafetyAxioms`: non-plastic constraints.
- `CognitiveGraph`: inspectable mutable graph.
- `CognitiveNode`: functional cognitive unit.
- `CognitiveEdge`: dynamic software synapse.
- `EvaluationResult`: feedback signal.
- `GrowthEngine`: reinforces and grows.
- `PruningEngine`: weakens and prunes.
- `DevelopmentalLedger`: append-only history.
- `DevelopmentalAgent`: orchestration layer.

## Training/evolution loop

AxiomGraph does not train a foundation model. It trains an agent architecture around a model or set of models. The model can remain fixed while the graph evolves routing, tool selection, memory organization, and specialization.

## Safety model

AxiomGraph allows bounded structural development. It does not allow unrestricted self-modification. Protected nodes, logging requirements, and growth limits are enforced by the non-plastic infrastructure layer.


## Compute Efficiency Layer

The `axiomgraph.compute` module adds compute-aware routing. It profiles tasks and execution resources, then chooses the cheapest reliable path across cache reuse, local GPU models, cloud transformer APIs, tools, and evaluators. This supports the invariant: maximize successful task completion per unit compute.
