from axiomgraph.graph import CognitiveEdge, CognitiveGraph, CognitiveNode
from axiomgraph.routing import Router, RouteStep


def _seeded_graph() -> CognitiveGraph:
    g = CognitiveGraph()
    for n in ("a", "b", "c", "d"):
        g.add_node(CognitiveNode(id=n, description=n))
    # Two outgoing edges from "a" with deliberately different scores.
    g.add_edge(CognitiveEdge(from_node="a", to_node="b", weight=0.9, trust_score=0.9, plasticity=0.5))
    g.add_edge(CognitiveEdge(from_node="a", to_node="c", weight=0.2, trust_score=0.4, plasticity=0.5))
    g.add_edge(CognitiveEdge(from_node="a", to_node="d", weight=0.6, trust_score=0.6, plasticity=0.5))
    return g


def test_router_returns_routesteps_sorted_descending_by_score():
    router = Router(_seeded_graph())
    steps = router.best_next_steps("a", limit=3)
    assert len(steps) == 3
    assert all(isinstance(s, RouteStep) for s in steps)
    scores = [s.score for s in steps]
    assert scores == sorted(scores, reverse=True)
    assert steps[0].to_node == "b"


def test_router_honors_limit():
    router = Router(_seeded_graph())
    assert len(router.best_next_steps("a", limit=2)) == 2
    assert len(router.best_next_steps("a", limit=1)) == 1


def test_router_returns_empty_for_node_with_no_outgoing_edges():
    g = CognitiveGraph()
    g.add_node(CognitiveNode(id="lonely", description="no outgoing"))
    assert Router(g).best_next_steps("lonely") == []
