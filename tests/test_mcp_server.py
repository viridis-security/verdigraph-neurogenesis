"""End-to-end tests for the AxiomGraph MCP layer.

These call the tool handlers directly (via the FastMCP registry) so we
exercise the same code path Claude/Cowork would, without spinning up a
real stdio transport.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import pytest

# Skip cleanly if the mcp extra isn't installed.
pytest.importorskip("mcp")


def _call(tool_name: str, **kwargs):
    """Invoke a FastMCP-registered tool handler synchronously."""
    from axiomgraph_mcp import server  # local import so AXIOMGRAPH_STATE_DIR takes effect

    # FastMCP wraps decorated functions; the underlying coroutine is the
    # module-level function with the same name.
    fn = getattr(server, tool_name)
    # Tools take either zero args, or a single Pydantic input model.
    if not kwargs:
        coro = fn()
    else:
        # Discover the model class from the type annotation. `from __future__ import
        # annotations` makes signatures stringified at runtime, so resolve via get_type_hints.
        import inspect, typing
        sig = inspect.signature(fn)
        params = list(sig.parameters.values())
        assert len(params) == 1, f"{tool_name} should accept exactly one params arg"
        hints = typing.get_type_hints(fn)
        model_cls = hints[params[0].name]
        coro = fn(model_cls(**kwargs))
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def isolated_state_dir(tmp_path, monkeypatch):
    """Give each test its own registry directory and reset the registry singleton."""
    monkeypatch.setenv("AXIOMGRAPH_STATE_DIR", str(tmp_path))
    # Force a fresh registry per test by reloading the module.
    import importlib
    import axiomgraph_mcp.server as srv
    importlib.reload(srv)
    yield


def _genome(name: str = "Test Agent") -> dict:
    return {
        "agent_name": name,
        "purpose": "End-to-end MCP test agent.",
        "initial_nodes": ["planner", "tool_router", "safety_checker", "evaluation_engine", "ledger"],
        "fitness_metrics": ["task_success"],
    }


def test_create_list_and_get_summary():
    out = _call("axiomgraph_create_agent", genome=_genome())
    payload = json.loads(out)
    assert "agent_id" in payload
    aid = payload["agent_id"]
    assert payload["summary"]["nodes"]

    listing = json.loads(_call("axiomgraph_list_agents"))
    assert any(a["agent_id"] == aid for a in listing["agents"])

    summary = json.loads(_call("axiomgraph_get_graph_summary", agent_id=aid))
    assert summary["agent_id"] == aid
    assert {n["id"] for n in summary["nodes"]} >= {"planner", "tool_router"}


def test_submit_evaluation_evolves_graph_and_writes_ledger():
    aid = json.loads(_call("axiomgraph_create_agent", genome=_genome()))["agent_id"]
    out = _call(
        "axiomgraph_submit_evaluation",
        agent_id=aid,
        task_id="t1",
        task_type="general",
        success_score=0.9,
        safety_score=1.0,
        used_edges=[("planner", "tool_router")],
        used_nodes=["planner", "tool_router"],
    )
    payload = json.loads(out)
    assert payload["new_ledger_events"], "submit_evaluation should produce ledger events"
    assert any(e["event_type"] == "edge_strengthened" for e in payload["new_ledger_events"])


def test_best_next_steps_returns_ranked_routes():
    aid = json.loads(_call("axiomgraph_create_agent", genome=_genome()))["agent_id"]
    for i in range(2):
        _call(
            "axiomgraph_submit_evaluation",
            agent_id=aid,
            task_id=f"t{i}",
            task_type="general",
            success_score=0.85,
            safety_score=1.0,
            used_edges=[("planner", "tool_router")],
            used_nodes=["planner", "tool_router"],
        )
    out = json.loads(_call("axiomgraph_best_next_steps", agent_id=aid, from_node="planner", limit=2))
    assert out["from_node"] == "planner"
    assert len(out["routes"]) >= 1
    # Scores must be non-increasing.
    scores = [r["score"] for r in out["routes"]]
    assert scores == sorted(scores, reverse=True)


def test_save_and_load_roundtrip(tmp_path):
    aid = json.loads(_call("axiomgraph_create_agent", genome=_genome("Persistable Agent")))["agent_id"]
    _call(
        "axiomgraph_submit_evaluation",
        agent_id=aid,
        task_id="t1",
        task_type="general",
        success_score=0.9,
        safety_score=1.0,
        used_edges=[("planner", "tool_router")],
        used_nodes=["planner", "tool_router"],
    )
    saved = json.loads(_call("axiomgraph_save_agent_state", agent_id=aid))
    assert Path(saved["path"]).exists()

    _call("axiomgraph_delete_agent", agent_id=aid, remove_file=False)

    loaded = json.loads(_call("axiomgraph_load_agent_state", source_path=saved["path"]))
    new_aid = loaded["agent_id"]
    summary = json.loads(_call("axiomgraph_get_graph_summary", agent_id=new_aid))
    # The restored graph should retain the edge we strengthened.
    edge = next((e for e in summary["edges"] if e["from"] == "planner" and e["to"] == "tool_router"), None)
    assert edge is not None
    assert edge["success_count"] == 1


def test_choose_compute_profile_enforces_min_quality():
    err = _call(
        "axiomgraph_choose_compute_profile",
        profiles=[{"id": "weak", "quality_score": 0.5, "local": True}],
        task={"id": "t", "task_type": "x", "min_quality": 0.80, "requires_local": True},
    )
    assert "No compute profile satisfies" in err


def test_choose_compute_profile_returns_decision():
    out = _call(
        "axiomgraph_choose_compute_profile",
        profiles=[
            {"id": "cheap_cache", "kind": "cache", "quality_score": 0.85, "latency_ms": 10, "local": True},
            {"id": "expensive_cloud", "kind": "api_model", "quality_score": 0.95, "cost_per_1k_input_tokens": 0.01, "latency_ms": 2000},
        ],
        task={"id": "t", "task_type": "easy", "min_quality": 0.80, "difficulty": 0.2, "risk": 0.1},
    )
    payload = json.loads(out)
    assert payload["profile_id"] == "cheap_cache"
    assert "score" in payload


def test_cache_and_escalation_policy_tools():
    assert json.loads(_call("axiomgraph_should_use_cache", cache_confidence=0.92, task_risk=0.2))["should_use_cache"]
    assert not json.loads(_call("axiomgraph_should_use_cache", cache_confidence=0.92, task_risk=0.8))["should_use_cache"]
    assert json.loads(_call("axiomgraph_should_escalate", current_confidence=0.5, task_risk=0.7))["should_escalate"]
    assert not json.loads(_call("axiomgraph_should_escalate", current_confidence=0.95, task_risk=0.7))["should_escalate"]
