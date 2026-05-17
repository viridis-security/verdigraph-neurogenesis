"""FastMCP stdio server for AxiomGraph NeuroGenesis.

Usage (after `pip install -e ".[mcp]"`):
    axiomgraph-mcp                          # stdio transport
    AXIOMGRAPH_STATE_DIR=~/.axiomgraph axiomgraph-mcp

Tools follow the `axiomgraph_*` naming convention so they don't collide with
other MCP servers an agent may have connected.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field

from axiomgraph.compute import ComputeOptimizer, ComputeProfile, TaskProfile
from axiomgraph.evaluation import EvaluationResult

from .registry import AgentRegistry


mcp = FastMCP("axiomgraph_mcp")
_registry = AgentRegistry()


# ============================== input schemas ===============================

class _Strict(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")


class CreateAgentInput(_Strict):
    genome: Dict[str, Any] = Field(
        ...,
        description=(
            "Genome dict matching `AgentGenome.from_dict`. Required keys: agent_name (str), "
            "purpose (str), initial_nodes (list[str]), fitness_metrics (list[str]). "
            "Optional: growth_rules (dict), safety_axioms (dict), metadata (dict)."
        ),
    )


class AgentIdInput(_Strict):
    agent_id: str = Field(..., description="ID returned by axiomgraph_create_agent or axiomgraph_list_agents.", min_length=1)


class GetLedgerInput(_Strict):
    agent_id: str = Field(..., description="Target agent ID.", min_length=1)
    limit: int = Field(default=50, description="Max events to return (most recent first).", ge=1, le=10000)


class BestNextStepsInput(_Strict):
    agent_id: str = Field(..., description="Target agent ID.", min_length=1)
    from_node: str = Field(..., description="Source node id in the cognitive graph.", min_length=1)
    limit: int = Field(default=3, description="Max routes to return.", ge=1, le=100)


class SubmitEvaluationInput(_Strict):
    agent_id: str = Field(..., description="Target agent ID.", min_length=1)
    task_id: str = Field(..., description="Unique id for this task evaluation.", min_length=1)
    task_type: str = Field(..., description="Task type; repeated types trigger specialist growth.", min_length=1)
    success_score: float = Field(..., description="Primary success signal in [0, 1].", ge=0.0, le=1.0)
    accuracy: float = Field(default=0.0, description="Accuracy in [0, 1].", ge=0.0, le=1.0)
    user_satisfaction: float = Field(default=0.0, description="User satisfaction in [0, 1].", ge=0.0, le=1.0)
    cost_efficiency: float = Field(default=0.0, description="Cost efficiency in [0, 1].", ge=0.0, le=1.0)
    safety_score: float = Field(default=1.0, description="Safety score in [0, 1].", ge=0.0, le=1.0)
    notes: str = Field(default="", description="Free-form notes.")
    used_edges: List[Tuple[str, str]] = Field(
        default_factory=list,
        description="List of (from_node, to_node) edges that contributed to the outcome.",
    )
    used_nodes: List[str] = Field(
        default_factory=list,
        description="List of node ids that contributed to the outcome.",
    )


class SaveAgentInput(_Strict):
    agent_id: str = Field(..., description="Agent to persist.", min_length=1)


class LoadAgentInput(_Strict):
    source_path: str = Field(..., description="Path to a JSON state file written by axiomgraph_save_agent_state.", min_length=1)
    agent_id: Optional[str] = Field(default=None, description="Optional explicit agent_id; otherwise slugified from the genome name.")


class DeleteAgentInput(_Strict):
    agent_id: str = Field(..., description="Agent to remove from the registry.", min_length=1)
    remove_file: bool = Field(default=False, description="Also delete the on-disk state file, if any.")


class _ProfileSchema(_Strict):
    id: str = Field(..., min_length=1)
    kind: str = Field(default="model", description="One of: cache, local_model, api_model, tool, evaluator.")
    quality_score: float = Field(default=0.5, ge=0.0, le=1.0)
    cost_per_1k_input_tokens: float = Field(default=0.0, ge=0.0)
    cost_per_1k_output_tokens: float = Field(default=0.0, ge=0.0)
    latency_ms: float = Field(default=1000.0, ge=0.0)
    gpu_memory_gb: float = Field(default=0.0, ge=0.0)
    max_context_tokens: int = Field(default=4096, ge=1)
    local: bool = Field(default=False)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class _TaskSchema(_Strict):
    id: str = Field(..., min_length=1)
    task_type: str = Field(..., min_length=1)
    difficulty: float = Field(default=0.5, ge=0.0, le=1.0)
    risk: float = Field(default=0.5, ge=0.0, le=1.0)
    expected_input_tokens: int = Field(default=1000, ge=0)
    expected_output_tokens: int = Field(default=500, ge=0)
    min_quality: float = Field(default=0.5, ge=0.0, le=1.0)
    requires_local: bool = Field(default=False)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ChooseProfileInput(_Strict):
    profiles: List[_ProfileSchema] = Field(..., description="Candidate compute profiles.", min_length=1)
    task: _TaskSchema = Field(..., description="Task profile to route.")


class CachePolicyInput(_Strict):
    cache_confidence: float = Field(..., ge=0.0, le=1.0)
    task_risk: float = Field(..., ge=0.0, le=1.0)
    threshold: float = Field(default=0.88, ge=0.0, le=1.0)


class EscalationPolicyInput(_Strict):
    current_confidence: float = Field(..., ge=0.0, le=1.0)
    task_risk: float = Field(..., ge=0.0, le=1.0)
    min_confidence: float = Field(default=0.78, ge=0.0, le=1.0)


# ================================= helpers ==================================

def _dump(obj: Any) -> str:
    return json.dumps(obj, indent=2, default=str)


def _graph_summary(agent_id: str) -> dict:
    agent = _registry.get(agent_id)
    return {
        "agent_id": agent_id,
        "agent_name": agent.genome.agent_name,
        "nodes": [
            {
                "id": n.id,
                "type": n.type,
                "status": n.status,
                "trust_score": round(n.trust_score, 4),
                "usage_count": n.usage_count,
                "success_count": n.success_count,
                "failure_count": n.failure_count,
            }
            for n in agent.graph.nodes.values()
        ],
        "edges": [
            {
                "id": e.id,
                "from": e.from_node,
                "to": e.to_node,
                "weight": round(e.weight, 4),
                "trust_score": round(e.trust_score, 4),
                "success_count": e.success_count,
                "failure_count": e.failure_count,
            }
            for e in agent.graph.edges.values()
        ],
        "ledger_events": len(agent.ledger.events),
    }


# ================================== tools ===================================

@mcp.tool(
    name="axiomgraph_create_agent",
    annotations={"title": "Create AxiomGraph agent", "readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False},
)
async def axiomgraph_create_agent(params: CreateAgentInput) -> str:
    """Instantiate a developmental agent from a genome dict and register it.

    Returns a JSON object with the assigned `agent_id` and an initial graph summary.
    """
    try:
        agent_id = _registry.create(params.genome)
        return _dump({"agent_id": agent_id, "summary": _graph_summary(agent_id)})
    except Exception as e:
        return f"Error: {type(e).__name__}: {e}"


@mcp.tool(
    name="axiomgraph_list_agents",
    annotations={"title": "List registered agents", "readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
)
async def axiomgraph_list_agents() -> str:
    """List every agent currently in the registry, with a compact summary."""
    return _dump({"agents": _registry.list_agents()})


@mcp.tool(
    name="axiomgraph_get_graph_summary",
    annotations={"title": "Get agent graph summary", "readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
)
async def axiomgraph_get_graph_summary(params: AgentIdInput) -> str:
    """Return a compact JSON view of an agent's cognitive graph (nodes + edges + stats)."""
    try:
        return _dump(_graph_summary(params.agent_id))
    except KeyError as e:
        return f"Error: {e}"


@mcp.tool(
    name="axiomgraph_get_agent_state",
    annotations={"title": "Get full agent state", "readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
)
async def axiomgraph_get_agent_state(params: AgentIdInput) -> str:
    """Return the full agent state dict — genome, graph, ledger. Same shape as save_state output."""
    try:
        return _dump(_registry.get(params.agent_id).to_dict())
    except KeyError as e:
        return f"Error: {e}"


@mcp.tool(
    name="axiomgraph_submit_evaluation",
    annotations={"title": "Submit task evaluation", "readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": False},
)
async def axiomgraph_submit_evaluation(params: SubmitEvaluationInput) -> str:
    """Apply a task evaluation to the agent. This triggers growth, reinforcement, and pruning per the genome.

    Returns a JSON object with the updated graph summary and the new ledger events generated by this evaluation.
    """
    try:
        agent = _registry.get(params.agent_id)
        events_before = len(agent.ledger.events)
        result = EvaluationResult(
            task_id=params.task_id,
            task_type=params.task_type,
            success_score=params.success_score,
            accuracy=params.accuracy,
            user_satisfaction=params.user_satisfaction,
            cost_efficiency=params.cost_efficiency,
            safety_score=params.safety_score,
            notes=params.notes,
            used_edges=list(params.used_edges),
            used_nodes=list(params.used_nodes),
        )
        agent.process_evaluation(result)
        new_events = [
            {"event_type": e.event_type, "reason": e.reason, "payload": e.payload, "timestamp": e.timestamp}
            for e in agent.ledger.events[events_before:]
        ]
        return _dump({"summary": _graph_summary(params.agent_id), "new_ledger_events": new_events})
    except (KeyError, ValueError, RuntimeError) as e:
        return f"Error: {type(e).__name__}: {e}"


@mcp.tool(
    name="axiomgraph_best_next_steps",
    annotations={"title": "Best next routing steps", "readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
)
async def axiomgraph_best_next_steps(params: BestNextStepsInput) -> str:
    """Return the top-k outgoing routes from a node, ranked by edge_score = weight·trust·success_rate / (cost·latency·risk)."""
    try:
        agent = _registry.get(params.agent_id)
        steps = agent.best_next_steps(params.from_node, limit=params.limit)
        return _dump({"from_node": params.from_node, "routes": [
            {"from": s.from_node, "to": s.to_node, "score": round(s.score, 6)} for s in steps
        ]})
    except KeyError as e:
        return f"Error: {e}"


@mcp.tool(
    name="axiomgraph_get_ledger",
    annotations={"title": "Get developmental ledger", "readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
)
async def axiomgraph_get_ledger(params: GetLedgerInput) -> str:
    """Return the most recent `limit` events from the agent's developmental ledger."""
    try:
        agent = _registry.get(params.agent_id)
        events = agent.ledger.events[-params.limit:]
        return _dump({"agent_id": params.agent_id, "events": [
            {"event_type": e.event_type, "reason": e.reason, "payload": e.payload, "timestamp": e.timestamp}
            for e in events
        ]})
    except KeyError as e:
        return f"Error: {e}"


@mcp.tool(
    name="axiomgraph_save_agent_state",
    annotations={"title": "Persist agent state to disk", "readOnlyHint": False, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
)
async def axiomgraph_save_agent_state(params: SaveAgentInput) -> str:
    """Persist the agent's full state to the registry's state directory as `<agent_id>.json`."""
    try:
        path = _registry.save(params.agent_id)
        return _dump({"agent_id": params.agent_id, "path": str(path)})
    except KeyError as e:
        return f"Error: {e}"


@mcp.tool(
    name="axiomgraph_load_agent_state",
    annotations={"title": "Load agent state from disk", "readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": True},
)
async def axiomgraph_load_agent_state(params: LoadAgentInput) -> str:
    """Load an agent state JSON file into the registry. Returns the assigned agent_id."""
    try:
        agent_id = _registry.load(params.source_path, agent_id=params.agent_id)
        return _dump({"agent_id": agent_id, "summary": _graph_summary(agent_id)})
    except (FileNotFoundError, KeyError, ValueError) as e:
        return f"Error: {type(e).__name__}: {e}"


@mcp.tool(
    name="axiomgraph_delete_agent",
    annotations={"title": "Remove agent from registry", "readOnlyHint": False, "destructiveHint": True, "idempotentHint": True, "openWorldHint": True},
)
async def axiomgraph_delete_agent(params: DeleteAgentInput) -> str:
    """Remove an agent from the in-memory registry. Optionally also delete its on-disk state file."""
    _registry.delete(params.agent_id, remove_file=params.remove_file)
    return _dump({"deleted": params.agent_id, "remove_file": params.remove_file})


@mcp.tool(
    name="axiomgraph_choose_compute_profile",
    annotations={"title": "Choose cheapest reliable compute profile", "readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
)
async def axiomgraph_choose_compute_profile(params: ChooseProfileInput) -> str:
    """Pick the cheapest reliable compute profile for a task.

    Enforces `min_quality` as a hard contract: any profile below the task's minimum quality
    is rejected outright, regardless of cost. Returns a `ComputeDecision` with the chosen
    profile id, score, estimated cost/latency/GPU memory, and a reason string.
    """
    try:
        optimizer = ComputeOptimizer(
            ComputeProfile(**p.model_dump()) for p in params.profiles
        )
        decision = optimizer.choose_profile(TaskProfile(**params.task.model_dump()))
        return _dump({
            "profile_id": decision.profile_id,
            "score": decision.score,
            "estimated_cost": decision.estimated_cost,
            "estimated_latency_ms": decision.estimated_latency_ms,
            "estimated_gpu_memory_gb": decision.estimated_gpu_memory_gb,
            "reason": decision.reason,
        })
    except ValueError as e:
        return f"Error: {e}"


@mcp.tool(
    name="axiomgraph_should_use_cache",
    annotations={"title": "Cache policy decision", "readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
)
async def axiomgraph_should_use_cache(params: CachePolicyInput) -> str:
    """Return True if cached reasoning is likely safe and efficient for this confidence/risk pair."""
    decision = ComputeOptimizer.should_use_cache(
        cache_confidence=params.cache_confidence,
        task_risk=params.task_risk,
        threshold=params.threshold,
    )
    return _dump({"should_use_cache": decision})


@mcp.tool(
    name="axiomgraph_should_escalate",
    annotations={"title": "Escalation policy decision", "readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
)
async def axiomgraph_should_escalate(params: EscalationPolicyInput) -> str:
    """Return True if the current route should escalate to a stronger model or evaluator."""
    decision = ComputeOptimizer.should_escalate(
        current_confidence=params.current_confidence,
        task_risk=params.task_risk,
        min_confidence=params.min_confidence,
    )
    return _dump({"should_escalate": decision})


# ================================== entry ===================================

def main() -> None:
    """Console-script entry point: run the stdio MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
