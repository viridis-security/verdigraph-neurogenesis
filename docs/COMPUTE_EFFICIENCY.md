# AxiomGraph Compute Efficiency Layer

AxiomGraph can improve AI-agent compute efficiency on local GPUs, cloud transformer APIs, or hybrid stacks by optimizing agent-level routing. It does not make transformer matrix multiplication itself cheaper; instead, it reduces wasted model calls, tool loops, token volume, context bloat, latency, and unnecessary escalation to expensive models.

## Core invariant

```text
maximize successful task completion per unit compute
```

A practical metric is:

```text
Cognitive Efficiency = Task Success / Compute Cost
```

Where compute cost can include:

```text
tokens + latency + GPU memory + API cost + tool calls + failed retries + evaluator calls
```

## What the layer optimizes

The compute layer tracks cost and value across nodes, edges, models, tools, and routes:

- model/API cost
- local GPU memory footprint
- latency
- token consumption
- success rate
- trust score
- task relevance
- safety/risk score
- cache confidence
- escalation frequency

## Routing pattern

```text
Task arrives
  -> classify difficulty and risk
  -> check cache/reused workflow
  -> choose cheapest reliable model/tool route
  -> escalate only when confidence or risk requires it
  -> evaluate result
  -> strengthen efficient successful pathways
  -> weaken costly failed pathways
```

## Local GPU use

For local inference, AxiomGraph can learn when to use:

- a small classifier
- a quantized local model
- a medium reasoning model
- a code-specialized model
- an embedding model
- a large local model only when needed
- a cloud fallback only when local confidence is insufficient

## Cloud transformer use

For API-based agents, AxiomGraph can reduce costs by:

- using cheaper models for easy tasks
- trimming irrelevant context
- reusing cached reasoning
- avoiding repeated failed tool loops
- using evaluators only when risk requires them
- selecting specialized modules instead of sending all tasks through one giant prompt

## New module

The repo includes `axiomgraph.compute`:

- `ComputeProfile` describes a model, tool, cache, or backend.
- `TaskProfile` describes task difficulty, risk, and token expectations.
- `ComputeOptimizer` chooses the cheapest reliable execution profile.
- `EfficiencyReport` aggregates task success and compute cost.

## Example

```python
from axiomgraph.compute import ComputeOptimizer, ComputeProfile, TaskProfile

profiles = [
    ComputeProfile(id="local_3b", kind="local_model", quality_score=0.62, latency_ms=450, gpu_memory_gb=3.5, local=True),
    ComputeProfile(id="cloud_strong", kind="api_model", quality_score=0.92, cost_per_1k_input_tokens=0.005, cost_per_1k_output_tokens=0.015, latency_ms=1800),
]

optimizer = ComputeOptimizer(profiles)
task = TaskProfile(id="t1", task_type="summary", difficulty=0.35, risk=0.2, min_quality=0.55)
decision = optimizer.choose_profile(task)
print(decision.profile_id)
```

## Product positioning

AxiomGraph can be positioned as an agent compute optimizer:

> A self-learning cognitive routing layer that reduces AI-agent compute waste by learning the cheapest reliable route for each task.

This is the software product bridge before physical NeuroGenesis hardware.
