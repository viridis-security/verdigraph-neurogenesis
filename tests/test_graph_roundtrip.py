"""Round-trip serialization is the durability boundary for AxiomGraph.

If `CognitiveGraph.to_dict()` and `from_dict()` lose state, `agent.save_state`
silently corrupts evolved agents. These tests pin the invariant.
"""

from axiomgraph.graph import CognitiveEdge, CognitiveGraph, CognitiveNode


def test_graph_to_dict_from_dict_preserves_state():
    original = CognitiveGraph()
    original.add_node(CognitiveNode(id="planner", description="plans", trust_score=0.7))
    original.add_node(CognitiveNode(id="executor", description="executes", trust_score=0.55))
    original.add_edge(
        CognitiveEdge(
            from_node="planner",
            to_node="executor",
            weight=0.42,
            trust_score=0.6,
            plasticity=0.8,
            success_count=3,
            failure_count=1,
            token_cost=2.5,
            latency_ms=120.0,
            risk_score=0.3,
        )
    )

    rebuilt = CognitiveGraph.from_dict(original.to_dict())

    assert set(rebuilt.nodes) == set(original.nodes)
    for node_id, node in original.nodes.items():
        copy = rebuilt.nodes[node_id]
        assert copy.description == node.description
        assert copy.trust_score == node.trust_score

    assert set(rebuilt.edges) == set(original.edges)
    edge = rebuilt.get_edge("planner", "executor")
    assert edge is not None
    assert edge.weight == 0.42
    assert edge.success_count == 3
    assert edge.failure_count == 1
    assert edge.token_cost == 2.5
    assert edge.latency_ms == 120.0
    assert edge.risk_score == 0.3
