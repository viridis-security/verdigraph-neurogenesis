# Verdigraph MCP Server

`verdigraph_mcp` exposes the Verdigraph framework as a stdio Model Context
Protocol (MCP) server. Any MCP-compatible client — Claude Desktop, Cowork,
Claude Code, custom agents — can use it to create developmental agents,
submit task evaluations, inspect cognitive graphs, route compute, and persist
state across sessions.

## Install

```bash
pip install -e ".[mcp]"
```

This adds the `mcp[cli]` and `pydantic` dependencies and registers an
`verdigraph-mcp` console script.

## Run

```bash
verdigraph-mcp                                    # stdio on PWD/verdigraph_state/
VERDIGRAPH_STATE_DIR=~/.verdigraph verdigraph-mcp # custom persistence dir
```

## Claude Desktop / Cowork config

Add to `claude_desktop_config.json` (Claude Desktop) or the equivalent MCP
config for Cowork:

```json
{
  "mcpServers": {
    "verdigraph": {
      "command": "verdigraph-mcp",
      "env": {
        "VERDIGRAPH_STATE_DIR": "/Users/YOU/.verdigraph"
      }
    }
  }
}
```

If `verdigraph-mcp` isn't on PATH, use the absolute path produced by
`which verdigraph-mcp` after `pip install`.

## Tools

All tools use the `verdigraph_` prefix to avoid collisions with other MCP
servers.

| Tool | Purpose |
|---|---|
| `verdigraph_create_agent` | Instantiate a `DevelopmentalAgent` from a genome dict; return its `agent_id`. |
| `verdigraph_list_agents` | List every registered agent with a compact summary. |
| `verdigraph_get_graph_summary` | Compact node/edge view of one agent. |
| `verdigraph_get_agent_state` | Full state dict (genome + graph + ledger). |
| `verdigraph_submit_evaluation` | Apply a task evaluation; triggers growth/pruning/reinforcement. Returns updated summary + new ledger events. |
| `verdigraph_best_next_steps` | Top-k outgoing routes from a node, ranked by edge score. |
| `verdigraph_get_ledger` | Recent developmental ledger events. |
| `verdigraph_save_agent_state` | Persist agent to `<state_dir>/<agent_id>.json`. |
| `verdigraph_load_agent_state` | Load an agent state file into the registry. |
| `verdigraph_delete_agent` | Remove agent from registry; optionally delete its file. |
| `verdigraph_choose_compute_profile` | Pick cheapest reliable compute profile; hard-enforces `min_quality`. |
| `verdigraph_should_use_cache` | Cache policy decision. |
| `verdigraph_should_escalate` | Escalation policy decision. |

## Safety invariants

- Every graph mutation goes through `DevelopmentalAgent.process_evaluation` —
  the MCP layer never bypasses growth rules, pruning rules, or safety axioms.
- `verdigraph_choose_compute_profile` enforces `min_quality` as a hard
  contract (see `docs/INVARIANTS.md`).
- Persistence files are written only to the configured `state_dir`.
- Agent state files are full round-trips: genome (including `growth_rules`
  and `safety_axioms`), graph, and ledger.

## Example session

```jsonc
// 1. Create an agent
verdigraph_create_agent({
  "genome": {
    "agent_name": "Research Assistant",
    "purpose": "Route research tasks through planning, search, synthesis.",
    "initial_nodes": ["planner", "search", "synthesis", "safety_checker", "evaluation_engine", "ledger"],
    "fitness_metrics": ["task_success", "factual_accuracy"]
  }
})
// -> {"agent_id": "research-assistant", ...}

// 2. Submit a successful evaluation
verdigraph_submit_evaluation({
  "agent_id": "research-assistant",
  "task_id": "t1",
  "task_type": "literature_review",
  "success_score": 0.9,
  "used_edges": [["planner", "search"], ["search", "synthesis"]],
  "used_nodes": ["planner", "search", "synthesis"]
})

// 3. Check evolved routes
verdigraph_best_next_steps({"agent_id": "research-assistant", "from_node": "planner", "limit": 3})

// 4. Persist
verdigraph_save_agent_state({"agent_id": "research-assistant"})
```
