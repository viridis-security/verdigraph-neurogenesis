import pytest

from verdigraph.graph import CognitiveEdge, CognitiveGraph, CognitiveNode


def test_graph_adds_nodes_and_edges():
    graph = CognitiveGraph()
    graph.add_node(CognitiveNode(id="a"))
    graph.add_node(CognitiveNode(id="b"))
    graph.add_edge(CognitiveEdge(from_node="a", to_node="b", weight=0.7))
    assert graph.get_edge("a", "b") is not None


def test_edge_requires_existing_nodes():
    graph = CognitiveGraph()
    graph.add_node(CognitiveNode(id="a"))
    with pytest.raises(ValueError):
        graph.add_edge(CognitiveEdge(from_node="a", to_node="missing"))
