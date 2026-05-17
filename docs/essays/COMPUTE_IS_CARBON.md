# Compute is Carbon: Why AI Needs a Thermodynamic Floor

*Justin Hart, Viridis LLC — May 2026*

---

## I. The trillion-token problem

A modern AI agent does not run one model call. It runs hundreds. A coding
agent answering a single question may invoke a planning model, a retrieval
model, an embedding model, two or three tool models, an evaluation model,
and a safety checker. A research agent doing a literature review may chain
fifty calls before producing a paragraph. A customer service agent in a
moderately complex flow may emit five thousand tokens to handle a request a
human would answer in twenty words.

Most of those tokens do not produce value. They produce retries, second
opinions, redundant context, failed tool loops, and unnecessary escalations.
A typical production agent stack today wastes between thirty and sixty
percent of its compute on work that contributes nothing to the final answer.

This was a finance problem when AI compute was cheap. It is becoming a
climate problem now that it is not.

Training a single frontier model now consumes electricity comparable to the
annual usage of small towns. Inference at the scale of consumer chat
products consumes far more in aggregate than training ever did. The 2025
data center buildout is the largest peacetime industrial energy expansion
in modern history. Every wasted token is a small contribution to a very
large number.

We need to stop treating AI compute as free. It is not free for the
operator's budget, and it is not free for the atmosphere.

## II. The thermodynamic ceiling

There is a physical upper bound on the rate at which information can be
produced by any system, including a transformer. It is set by the energy
the system has access to, the temperature at which it operates, and
Landauer's principle on the minimum energy cost of erasing a bit:

```
dI/dt  ≤  P · D / (k_B · T · ln 2)
```

where *dI/dt* is the rate of information production, *P* is the available
power, *D* is a dissipation-efficiency factor, *k_B* is Boltzmann's
constant, and *T* is operating temperature. The exact form is developed in
our companion paper *Intelligence Bound*, currently under review at
Physical Review E.

The practical implication is bracing: there is a maximum useful intelligence
you can extract from a given energy budget. Above the ceiling, additional
power produces no additional information — only heat. Below the ceiling,
the gap between actual information output and the bound represents
recoverable efficiency. Most production AI agents today operate far below
the ceiling. The gap is the opportunity.

This is the thermodynamic floor: no software can do better than the bound
allows, but most software does dramatically worse than the bound requires.
Closing that gap is the highest-impact systems-engineering problem in AI.

## III. The agent-orchestration layer is where the waste lives

The instinct in 2024 and 2025 was to chase efficiency in the model. Quantize
weights. Compile kernels. Push attention onto custom silicon. Build smaller
distilled variants. All of this is necessary work, and the model layer is
getting genuinely cheaper per FLOP at a remarkable rate.

But the model layer is not where most agent waste lives. The waste lives in
how the orchestration layer routes work to the model. A frontier API call
that should have been served from cache. A two-thousand-token context that
contained two hundred tokens of relevant material and eighteen hundred of
boilerplate. A reasoning loop that retried five times and would have
succeeded once if the failure path had been pruned. A small task that took
a four-hundred-billion-parameter model when a four-billion-parameter local
model would have answered correctly with no API egress.

Every one of these is a routing decision. Every routing decision can be
measured, scored, and learned from. The substrate to do that learning is
what we have built.

## IV. Verdigraph

Verdigraph treats an AI agent as a developmental cognitive system rather
than a static prompt-and-tool assembly. The agent is a graph of cognitive
nodes — modules for planning, retrieval, synthesis, evaluation, tool use,
safety — connected by weighted synaptic edges. Each edge tracks routing
strength, trust score, success rate, token cost, latency, GPU memory
footprint, risk score, and plasticity.

A digital genome bounds the agent's developmental space: which nodes are
protected, how aggressively growth is allowed, when pruning is permitted,
what evaluation signals drive change. An append-only developmental ledger
records every modification, with reason and timestamp. A compute-efficiency
layer chooses the cheapest reliable route for each task — across cached
reasoning, local models, cloud transformer APIs, specialized tools, and
high-assurance evaluators.

The central invariant is:

```
maximize successful task completion per unit compute
```

In practice that becomes a metric you can put on a chart:

```
Cognitive Efficiency  =  Task Success / Compute Cost
```

Where compute cost folds in tokens consumed, latency incurred, GPU memory
occupied, API spend, tool calls made, retry counts, and evaluator
invocations. A pathway that succeeds at high cost and a pathway that
succeeds at low cost are no longer scored the same. Over time, the cheap
reliable pathways strengthen. The expensive unreliable pathways prune.

The framework is MIT-licensed and ships with a Model Context Protocol
server. Any MCP-aware client — Claude Desktop, Cowork, Claude Code, custom
agent stacks — can drive it directly. Open the README; the install is one
command.

## V. The audit problem

Compute reductions are only valuable if you can prove them. "We reduced
your AI bill by forty percent" is a marketing slide. "We reduced your AI
bill by forty percent and here is the developmental ledger documenting
every routing decision the system made over the measurement period" is an
audit artifact.

Verdigraph's ledger is not optional. Every growth event, every edge
strengthening, every pruning action writes a structured log entry with
event type, reason, payload, and ISO-8601 timestamp. The protected nodes
declared in the genome cannot be silently removed. The maximum graph size
declared in the genome cannot be silently exceeded. Hidden nodes — modules
without documented purpose — are rejected at construction time.

This matters for two reasons. First, AI compliance regimes — the EU AI Act
Article 12 logging requirements, the forthcoming US executive order
guidance, the audit standards being drafted by SOC 2 and ISO around
generative AI — all converge on auditable logs of agent development and
decision-making. Most production agent stacks cannot produce these logs
without retrofitting. Verdigraph produces them by construction.

Second, the auditable ledger is what makes compute-to-carbon claims
verifiable. Without a record of what the system chose to do, "compute
saved" is a fiction. With the record, it is a measurement. That distinction
is the difference between a sustainability talking point and an emission
reduction your auditor will sign.

## VI. The compute-to-carbon equation

Once you have an auditable record of compute consumed under a baseline
policy and compute consumed under the Verdigraph policy, the rest is
arithmetic. Tokens map to FLOPs map to joules via published efficiency
factors for each model family. Joules map to kilowatt-hours. Kilowatt-hours
map to CO2-equivalent emissions via the operator's local grid carbon
intensity, available from regulators in every developed economy and from
the EPA in the United States.

The math is not mysterious. The reason nobody has been doing it is that
nobody has had an auditable ledger over which to compute it. We do.

A future *Verified Compute-Efficiency Report* — an artifact we plan to
ship as a paid product — turns a customer's Verdigraph ledger over a
measurement period into:

- Total token volume saved versus a stated baseline policy
- Kilowatt-hours of electricity avoided
- CO2e emissions avoided, computed against the customer's grid mix
- A third-party-attestable summary an auditor or sustainability officer
  can sign

A portion of revenue from those reports will fund verified conservation
work — initial allocation is being finalized; the commitment will be on
the public ledger.

## VII. Why this matters beyond bills

The energy footprint of AI is real and growing, and the political response
will follow. Within five years there will be carbon caps on data center
emissions, mandatory disclosures on AI compute, and procurement
requirements that AI vendors document the emissions intensity of their
services. Some of this will be useful. Some of it will be theater.

The companies that will win the useful version are the ones that built
auditable efficiency into the substrate from the start. The companies that
will lose are the ones that bolt sustainability talking points onto
already-wasteful stacks and hope nobody verifies. The technology to do
this right exists. The will to deploy it does not yet.

What we are building is the technology, the substrate, and the
verification framework. The will, we expect, will follow procurement
incentives and regulatory pressure on a one-to-three-year timeline.

## VIII. The connection to conservation

Viridis LLC is a conservation technology company. Verdigraph is one of
three interconnected projects in our portfolio. The others are HDFM, our
high-density forest management agent platform, and Sentinel / OpenClaw,
our auditable security research agent. All three sit on the same
developmental substrate. All three benefit from the same compute-efficiency
work. All three are scored against the same thermodynamic floor.

The reason a conservation technology company is shipping an AI infrastructure
framework is that compute is carbon, carbon is climate, climate is
biodiversity, and biodiversity is the thing we are in the business of
preserving. The connection runs all the way down. Verdigraph is the layer
where software meets physics meets the budget for a habitable Earth.

This is also why we believe the framework should be free and open. The
substrate is the commons. Commercial offerings on top — hosted MCP service,
Verified Compute-Efficiency Reports, vertical agent kits, IP licensing —
fund the continued work and a share of conservation programs. We do not
need to be the only operator. We do need the substrate to exist.

## IX. The invitation

If you are running an AI agent stack today, you are probably wasting more
compute than you realize. The drop-in MCP server is the fastest way to
find out. Five minutes of setup, two weeks of measurement, and you will
have a number.

If you are doing research on agent development, specialization, compute
efficiency, or the thermodynamics of intelligence, Verdigraph is a
substrate purpose-built for those questions. The code is yours to extend.
The papers are yours to cite. The conversation is yours to join.

If you build hardware — neuromorphic substrates, memristive arrays,
solution-grown conductive scaffolds — the digital substrate is designed to
map forward to physical embodiment. Paper 1 of our series sketches the
bridge.

If you are a procurement leader, a sustainability officer, or a regulator
thinking about how to make AI's energy footprint legible, the auditable
ledger is the artifact you have been waiting for. Run the demo.

If you are a fellow traveler — someone who has stared at an inference bill,
a heat map of a data center, and a melting glacier and thought "there is a
connection here" — welcome. There is a connection. We are building toward
it. We would like your help.

---

*The code is at [github.com/viridis-llc/verdigraph-neurogenesis](https://github.com/viridis-llc/verdigraph-neurogenesis). The papers are in the
[`papers/`](../../papers/) directory of the repository. The MCP server is in
[`verdigraph_mcp/`](../../verdigraph_mcp/). If any of this resonates, get
in touch.*
