# verdigraph-neurogenesis

> Clone this repo, run one script, and within 60 seconds you're building **deterministic, content-addressed brain artifacts** from any agent file — Claude project export, OpenAI Assistant config, raw prompt list, or Verdigraph genome JSON. Pure Python core; zero external services required.

[![python](https://img.shields.io/badge/python-3.10+-blue?style=flat-square)](https://www.python.org)
[![tests](https://img.shields.io/badge/tests-145%20passing-success?style=flat-square)](#tests)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.20261687.svg)](https://doi.org/10.5281/zenodo.20261687)

---

## 60-second quickstart

```bash
git clone https://github.com/viridis-security/verdigraph-neurogenesis
cd verdigraph-neurogenesis
bash quickstart.sh
```

That's it. The script creates a venv, installs the package editable, runs the brain builder against an example genome, and prints the deterministic `brain_id` + `content_hash`. **No Cloudflare account, no Stripe key, no `verdigraph.dev` account needed.** Everything runs locally.

If you also have an internet connection, the script will additionally hit `https://verdigraph.dev/app/import` with the same input bytes and confirm the hosted Worker produces the exact same `brain_id` — that's your proof the local build is byte-equivalent to the production reference implementation.

---

## What it is

Verdigraph turns an agent file into an **inspectable cognitive graph** with a content-addressed identifier you can pin in git, cite in an audit, or paste into a code review. Three things make this useful:

1. **Determinism.** Identical input bytes always produce identical `brain_id`, `content_hash`, and graph structure. Run it twice, get the same answer twice. Run it in Python locally; run it in TypeScript on the Worker; same answer either way.
2. **Inspectable structure.** Every brain carries 9 firing invariants + 1 advisory check (`I9_fitness_metric_wired`) so you can prove what the agent file actually compiles to without trusting a black box.
3. **Self-contained build pipeline.** No external dependencies beyond the Python stdlib. No SaaS lock-in. You can audit every line of `verdigraph/brain.py` (≈ 660 lines) in an afternoon.

---

## Use it

### Build a brain from a Verdigraph genome

```bash
python -m verdigraph build --file examples/hypothetical_research_agent.genome.json --format verdigraph_genome --pretty
```

Or pipe input:

```bash
cat my_agent.json | python -m verdigraph build --stdin --format auto --summary --pretty
```

### Build from a Claude project export

```bash
python -m verdigraph build --file my_claude_project_export.json --format claude_project_export --pretty
```

### Build from an OpenAI Assistant config

```bash
python -m verdigraph build --file my_assistant.json --format openai_assistant --pretty
```

### Build from a flat prompt list

```bash
echo -e "You are a helpful assistant.\nSummarize the user's request.\nPlan steps and execute." \
  | python -m verdigraph build --stdin --format prompt_list --pretty
```

### Re-verify a saved brain artifact

```bash
python -m verdigraph build --file my_agent.json --pretty > brain.json
python -m verdigraph verify brain.json
```

---

## Use it as a Python library

```python
from verdigraph.brain import extract, verify_brain, to_dict

genome = b'{"agent_name":"my_agent","purpose":"...","initial_nodes":["planner","executor"],"fitness_metrics":["task_success_rate"]}'

brain = extract("verdigraph_genome", genome)
print(brain.brain_id)        # e.g. RMX124YY916WP0TCSEHFYX7M30
print(brain.brain_uri)       # verdigraph://brain/RMX124YY916WP0TCSEHFYX7M30
print(brain.content_hash)    # sha256 hex
print(len(brain.nodes), "nodes,", len(brain.edges), "edges")

report = verify_brain(brain)
assert report.passed         # all non-advisory invariants pass

print(to_dict(brain))        # serialize for storage / round-trip
```

---

## Expose it as an MCP server for your LLM agent

```bash
pip install -e ".[mcp]"
verdigraph-mcp                 # runs over stdio
```

Then in Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "verdigraph": {
      "command": "/absolute/path/to/repo/.venv/bin/verdigraph-mcp",
      "args": []
    }
  }
}
```

Or in Claude Code: `claude mcp add --transport stdio verdigraph /absolute/path/to/repo/.venv/bin/verdigraph-mcp`.

Restart your client. Your agent now has `verdigraph_*` tools to build/verify/evolve brains directly. No network calls; everything runs on your machine.

---

## Determinism and verifiability

| Field | What it is | How to verify |
|---|---|---|
| `brain_id` | 26-char Crockford-base32; derived from `sha256(input_bytes + b":" + format)` | `python -m verdigraph build --file <same bytes>` — same id every time |
| `brain_uri` | `verdigraph://brain/<brain_id>` | Self-describing form; safe for content-safety classifiers |
| `content_hash` | `sha256(canonicalize(brain_body_minus_content_hash))` | See [docs/CANONICALIZATION.md](docs/CANONICALIZATION.md) for the exact algorithm |
| `input_sha256` | `sha256(raw_input_bytes)` | `sha256sum your_file.json` |
| Invariant report | 9 required checks + 1 advisory `I9_fitness_metric_wired` | All carry `id`, `description`, `passed`, optional `passed_with_default`, `advisory`, `detail` |

### Canonicalization rule (one sentence)

Apply `json.dumps` with `separators=(",", ":")` after recursively sorting every object's keys lexicographically by codepoint and coercing integer-valued floats to integers (matches JavaScript `JSON.stringify` byte-for-byte). UTF-8 encoded before hashing. See `verdigraph/brain.py::canonicalize` (≈ 20 lines, stdlib only).

---

## Layout

```
verdigraph-neurogenesis/
├── README.md                     ← you are here
├── quickstart.sh                 ← clone → first brain in 60 seconds
├── pyproject.toml                ← Python package metadata
├── verdigraph/                   ← Python core (no external deps)
│   ├── brain.py                  ← deterministic build pipeline (extract / canonicalize / verify / evolve)
│   ├── cli.py                    ← `python -m verdigraph` CLI
│   ├── genome.py                 ← AgentGenome / GrowthRules / SafetyAxioms (live-agent runtime)
│   ├── graph.py                  ← CognitiveGraph / CognitiveNode / CognitiveEdge
│   ├── agent.py                  ← DevelopmentalAgent (live-agent runtime)
│   ├── growth.py / pruning.py    ← evolution operators
│   ├── evaluation.py             ← task-outcome ledger
│   ├── compute.py                ← compute-routing helpers
│   └── ledger.py                 ← immutable event log
├── verdigraph_mcp/               ← optional: stdio MCP server (`pip install -e ".[mcp]"`)
├── tests/                        ← pytest, all green on a clean clone
├── examples/                     ← runnable demos with fixture genomes
├── docs/                         ← canonicalization spec, architecture, invariants
├── papers/                       ← three companion papers (Zenodo-archived)
└── hosted-mcp/                   ← OPTIONAL: Cloudflare Workers deployment if you want a hosted instance
```

---

## Optional: deploy your own hosted instance

A reference Cloudflare Workers deployment lives in `hosted-mcp/`. It serves the same deterministic-build pipeline over HTTPS + OAuth 2.1 + PKCE, adds prepaid USD credits via Stripe, and Ed25519-signed compliance attestations. **You do not need this to use the Python core.** It exists because the same protocol can run hosted if you want a shared multi-caller environment. See [hosted-mcp/README.md](hosted-mcp/README.md) for deployment instructions.

A live reference deployment runs at [https://verdigraph.dev](https://verdigraph.dev) — same byte-equivalent pipeline. The local Python implementation is the canonical source; the Worker is a reimplementation for hosting convenience.

---

## Run the tests

```bash
source .venv/bin/activate
pip install -e ".[dev]"
pytest -q
```

The `tests/test_brain_parity.py` suite locks the deterministic-build contract — specifically that `b'{"agent_name":"x","purpose":"y","initial_nodes":["a"],"fitness_metrics":["task_success_rate"]}'` produces `brain_id == "RMX124YY916WP0TCSEHFYX7M30"` and `content_hash == "20b9e5be0e5a0d34e564df6d0a554b1232ff9cc3ff309ab8da77a97756602c0c"`. If either side ever drifts, that test fails on the next CI run and we ship the divergence as a deliberate schema bump.

---

## Companion papers

In `papers/`:

1. `PAPER_1_Physical_NeuroGenesis_SynapseForge.md` — physical version: AI-agent-architected, 3D-printed, solution-grown neuromorphic substrates.
2. `PAPER_2_Verdigraph_Digital_NeuroGenesis.md` — software version: self-evolving digital cognitive graphs.
3. `PAPER_3_Verdigraph_Compute_Efficiency.md` — compute-efficiency layer.

To cite:

> Hart, Justin. (2026). *Verdigraph NeuroGenesis: A Software Framework for Self-Evolving AI-Agent Cognitive Substrates* (Version 0.1.0). Zenodo. https://doi.org/10.5281/zenodo.20261687

---

## License & contact

MIT. Maintained by Viridis LLC. Contact: `hartjustin6@gmail.com`.

This is an experimental research framework. It does not create autonomous unrestricted self-modifying AI. All growth and pruning actions are constrained by explicit genome rules, safety invariants, and an auditable ledger.
