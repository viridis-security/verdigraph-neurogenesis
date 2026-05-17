# Vision

AxiomGraph NeuroGenesis is built on a simple observation: **AI agents waste
energy at industrial scale, and energy is carbon.**

Most agent frameworks today treat the agent as a static assembly of prompts
and tools. The same task runs through the same path every time. Failed
reasoning loops repeat. Frontier models get called for trivial work. Caches
go unused. Every redundant token is a joule of electricity that produced no
useful result.

We think this is solvable, and that solving it is one of the highest-impact
things software can do for the climate this decade.

## The framing

An AI agent is a cognitive system. Like biological cognitive systems, it
should *develop* — strengthening pathways that work, weakening those that
don't, growing specialized modules for recurring tasks, and pruning structure
that no longer earns its compute cost. The architecture should be inspectable,
the development should be auditable, and the optimization target should be
explicit: **maximize successful task completion per unit compute.**

That is what AxiomGraph implements. The agent is a graph of cognitive nodes
and weighted synaptic edges. A digital genome bounds growth. An append-only
ledger records every change. A safety axiom layer prevents the parts that
must not move from moving. A compute-efficiency layer learns the cheapest
reliable route for each task — across caches, local models, cloud APIs, tools,
and evaluators.

## Why Viridis

Viridis LLC is a conservation technology company. AxiomGraph is one of three
interconnected projects we're building:

- **HDFM** — high-density forest management agents
- **Sentinel / OpenClaw** — auditable security research agents
- **Energy AI** — compute-aware agents for grid and demand-response

The same developmental substrate underpins all three. The same compute-
efficiency metric — task success per unit compute — governs whether each one
earns its energy cost. The thermodynamic foundation comes from companion
academic work on the upper bounds of information production.

We believe the framework should be free and open. The MIT-licensed core is
the substrate. Commercial offerings on top fund continued research and a
share of conservation work.

## What we want

- **Researchers** to use AxiomGraph as a substrate for studying agent
  development, specialization, and compute-efficient routing.
- **Engineers** to drop the MCP server into existing agent stacks and start
  measuring savings.
- **Companies** to treat their AI compute as a carbon line item, audit it
  with the developmental ledger, and reduce it with verifiable proof.
- **Collaborators** who want to extend this to physical neuromorphic
  substrates (see Paper 1: *Viridis NeuroGenesis / SynapseForge*).

## What we will not do

We will not optimize for agent-framework feature breadth. We will not
become "another LangChain." We will not ship growth that bypasses safety
invariants. We will not claim carbon reductions we cannot verify against
the ledger.

We will compete on the depth of the invariants — inspectable,
audit-loggable, compute-efficient, and theoretically grounded — and on the
mission alignment of routing AI compute toward less wasted energy and a
habitable Earth.

## Where to start

- Read [README.md](README.md) for installation and a five-minute demo.
- Read [docs/INVARIANTS.md](docs/INVARIANTS.md) for the safety contract.
- Read [docs/MCP_SERVER.md](docs/MCP_SERVER.md) for the MCP integration.
- Read [docs/essays/COMPUTE_IS_CARBON.md](docs/essays/COMPUTE_IS_CARBON.md)
  for the long-form argument.
- Read the three companion papers in [`papers/`](papers/) for the theory.

If any of this resonates and you'd like to collaborate, partner, or
deploy — get in touch.
