# The Viridis Operator Agent — Verdigraph operating Verdigraph

The `examples/viridis_operator.genome.json` genome defines an agent whose
purpose is to operate the Verdigraph NeuroGenesis project itself. It
triages GitHub issues, reviews pull requests, plans releases, keeps
documentation current, runs the test suite on proposed changes, routes
compute decisions through the cheapest reliable path, and maintains an
auditable developmental ledger of every action.

**This is the framework managing its own development.** Verdigraph
operating Verdigraph. Viridis LLC ships it as a public reference
implementation; anyone can run their own variant against their own
projects.

## The agent at a glance

| | |
|---|---|
| **Name** | Viridis Operator |
| **Genome** | [`examples/viridis_operator.genome.json`](../examples/viridis_operator.genome.json) |
| **Demo** | [`examples/viridis_operator_demo.py`](../examples/viridis_operator_demo.py) |
| **Cognitive nodes** | 12 (intent_classifier, issue_triage, code_review, release_planner, docs_updater, test_runner, github_router, verdigraph_router, compute_optimizer, safety_checker, evaluation_engine, ledger) |
| **Protected nodes** | github_router, verdigraph_router, safety_checker, evaluation_engine, ledger |
| **Bounds** | max 64 nodes, max 256 edges, prune below weight 0.12 |
| **Fitness metrics** | task_success, code_quality, response_time, compute_efficiency, safety_score, documentation_freshness |
| **Compute floor** | `compute_quality_floor: 0.70` — hard reject of any execution profile below 70% quality |
| **Human-review gates** | release actions, destructive GitHub actions |
| **Rate limit** | `max_outbound_github_writes_per_hour: 30` |

## What it does

1. **Issue triage.** Receives a new GitHub issue, classifies intent
   (bug / feature / question / non-actionable), assigns labels, asks the
   submitter clarifying questions if needed, routes to the responsible
   subagent. Cheap tasks; defaults to a small local model or cache.

2. **Code review.** Reviews a pull request against the safety invariants
   in `docs/INVARIANTS.md`. Runs the test suite first; pulls in the
   evaluator tier only when test coverage looks thin or the change
   touches the safety axiom layer. Posts review comments; never merges
   without human approval.

3. **Release planning.** Plans the next minor release: collects merged
   PRs since the last tag, generates CHANGELOG draft, runs the full
   test matrix, drafts release notes, opens a release PR. Tagging and
   publishing are human-gated.

4. **Documentation updates.** Detects when code changes diverge from
   docs (e.g., a new public function with no docstring, a renamed
   class) and proposes doc patches.

5. **Compute-efficiency routing.** Every task above gets a compute
   decision via `axiomgraph.compute.ComputeOptimizer`. The cheapest
   profile that meets the task's `min_quality` wins. Decisions are
   logged in the agent's developmental ledger for audit.

6. **Self-evolution.** Recurring task patterns grow specialist nodes
   (`bug_report_specialist`, `dependency_bump_specialist`, etc.).
   Pathways that succeed strengthen; pathways that fail or take too
   long weaken or prune.

## Running it locally — 60 seconds

```bash
pip install -e ".[mcp]"
python examples/viridis_operator_demo.py
```

Runs a synthetic workload of 7 project-operations tasks (issue triage,
PR review, doc update, release planning) through the agent. Prints
compute-routing decisions, learned route preferences, grown specialist
nodes, and ledger summary. Saves evolved state to
`examples/output/viridis_operator_evolved_state.json`.

Typical first-run output:

```
Compute routing decisions:
  cloud_haiku               → 7 task(s)

  Total estimated cost over 7 tasks: $0.04384
  (Baseline 'always use opus_evaluator' would cost ~$0.21000)
```

That ~79% savings is the headline number for the compute-efficiency
story. With more diverse tasks (some routable to local models, some to
cache), savings typically scale to 60–80%.

## Running it for real — Claude Desktop / Cowork / Claude Code

In production the operator agent runs *behind* an MCP-capable client.
The client receives external events (a GitHub webhook, a CI run
result, a human ping in chat) and routes them through the agent via
MCP tools.

### MCP connections

You need TWO MCP servers connected:

1. **`verdigraph-mcp`** — the framework's own MCP, ships with this repo.
   The operator agent state lives here. Provides `verdigraph_*` tools
   for creating agents, submitting evaluations, querying routes, etc.

2. **`github-mcp`** — the official GitHub MCP server
   (https://github.com/github/github-mcp-server). Provides tools for
   reading issues/PRs, posting comments, opening branches, etc.

### `claude_desktop_config.json` snippet

```json
{
  "mcpServers": {
    "verdigraph": {
      "command": "verdigraph-mcp",
      "env": {
        "VERDIGRAPH_STATE_DIR": "/Users/YOU/.verdigraph"
      }
    },
    "github": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-PAT-with-repo-scope>"
      }
    }
  }
}
```

Replace `/Users/YOU/.verdigraph` and the GitHub PAT with your values.
The verdigraph entrypoint is installed by `pip install -e ".[mcp]"`.

### Bootstrapping the agent in a fresh client session

Once both MCPs are connected, the client (Claude Desktop, Cowork, etc.)
bootstraps the agent like this:

```jsonc
// 1. Load the agent state from disk (or create from genome on first run)
verdigraph_load_agent_state({
  "source_path": "/Users/YOU/.verdigraph/viridis-operator.json"
})
// -> {"agent_id": "viridis-operator", ...}

// Alternatively, create fresh from genome:
verdigraph_create_agent({
  "genome": { /* contents of viridis_operator.genome.json */ }
})
```

### Handling an inbound GitHub issue

When a new issue arrives (the client receives a webhook, or you paste
the issue URL into chat):

```jsonc
// 1. Pull the issue from GitHub
github_get_issue({"owner": "VIRIDIS", "repo": "verdigraph-neurogenesis", "issue_number": 42})

// 2. Pick the compute profile for the triage task
verdigraph_choose_compute_profile({
  "profiles": [/* your configured ComputeProfiles */],
  "task": {"id": "issue-42", "task_type": "issue_triage", "difficulty": 0.25, "risk": 0.10, "min_quality": 0.70}
})
// -> {"profile_id": "cloud_haiku", "estimated_cost": 0.0006, ...}

// 3. The model (Haiku in this case) drafts the triage outcome.
//    Then submit the evaluation back to the agent.
verdigraph_submit_evaluation({
  "agent_id": "viridis-operator",
  "task_id": "issue-42",
  "task_type": "issue_triage",
  "success_score": 0.92,
  "safety_score": 1.0,
  "used_edges": [["intent_classifier", "issue_triage"], ["issue_triage", "github_router"]],
  "used_nodes": ["intent_classifier", "issue_triage", "github_router", "ledger"]
})

// 4. The agent strengthens those pathways, logs the event, and the
//    response (labels + comment) goes out via the GitHub MCP:
github_add_labels({"owner": "VIRIDIS", "repo": "verdigraph-neurogenesis", "issue_number": 42, "labels": ["bug", "compute-layer"]})
github_create_comment({"owner": "VIRIDIS", "repo": "verdigraph-neurogenesis", "issue_number": 42, "body": "Thanks for the report. ..."})

// 5. Persist the evolved agent state so the next session resumes here.
verdigraph_save_agent_state({"agent_id": "viridis-operator"})
```

## Safety invariants this agent enforces

From the genome's `safety_axioms`:

- **`github_router` and `verdigraph_router` are protected.** The agent
  cannot prune the channels through which it reaches the outside world
  or itself. Any attempt is rejected by `_enforce_invariants` and
  raises at evaluation time.
- **All growth and pruning events are logged.** The developmental
  ledger is the audit trail; nothing happens off-ledger.
- **No hidden nodes.** Every cognitive node carries a description.
- **No silent pruning of protected nodes.** Combined with logging, this
  makes the agent's behavior fully reproducible.
- **Custom: `require_human_review_for_release: true`.** The agent will
  draft releases and open the PR; the actual tag-and-publish step is
  human-only.
- **Custom: `require_human_review_for_destructive_github_action: true`.**
  Any deletion-class action (deleting branches, force-pushing, deleting
  comments) goes through a human gate.
- **Custom: `compute_quality_floor: 0.70`.** Compute profiles below 70%
  quality are rejected outright, regardless of cost. The savings story
  never trades against task quality.
- **Custom: `max_outbound_github_writes_per_hour: 30`.** Prevents the
  agent from spamming the repo through a faulty growth loop. The client
  enforces this via rate-limiting the github MCP calls.

## Why this matters for the launch story

This is the agent the framework was built to support. The Verdigraph
v0.1.0 deposit (DOI [10.5281/zenodo.20261687](https://doi.org/10.5281/zenodo.20261687))
contains both the substrate AND a working reference operator for that
substrate. Viridis dogfoods its own product as the first credible test.

The pitch becomes: *"We built a developmental cognitive substrate. We
shipped it open source. We run our own project on it. Here's the
agent that does that, here's the cost savings, here's the audit
ledger. Bring your own project."*

## See also

- [Verdigraph framework README](../README.md)
- [The MCP server documentation](MCP_SERVER.md)
- [Safety invariants](INVARIANTS.md)
- [Compute-efficiency design](COMPUTE_EFFICIENCY.md)
- [Compute is Carbon (launch essay)](essays/COMPUTE_IS_CARBON.md)

---

*Last reviewed: 2026-05-17. Updated whenever the operator genome changes.*
