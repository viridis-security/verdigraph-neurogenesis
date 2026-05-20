"""Lock the deterministic-build contract — pure Python, no network, no hosted dependency."""
from __future__ import annotations

from verdigraph.brain import (
    extract, canonicalize, sha256_hex, derive_brain_id,
    verify_brain, detect_format, to_dict, report_to_dict,
)


def test_minimal_genome_produces_known_brain_id():
    """The smallest viable genome must produce RMX124YY916WP0TCSEHFYX7M30.
    This id is byte-shared with the verdigraph.dev TS Worker; if either side
    drifts, this test fails immediately on next CI run."""
    body = b'{"agent_name":"x","purpose":"y","initial_nodes":["a"],"fitness_metrics":["task_success_rate"]}'
    brain = extract("verdigraph_genome", body)
    assert brain.brain_id == "RMX124YY916WP0TCSEHFYX7M30"
    assert brain.content_hash == "20b9e5be0e5a0d34e564df6d0a554b1232ff9cc3ff309ab8da77a97756602c0c"
    assert brain.brain_uri == "verdigraph://brain/RMX124YY916WP0TCSEHFYX7M30"


def test_identical_bytes_produce_identical_artifact():
    """5 rebuilds of the same input must produce identical brain_id + content_hash."""
    body = b'{"agent_name":"claude_partner","purpose":"research","initial_nodes":["planner","executor"],"fitness_metrics":["task_success_rate"]}'
    out = []
    for _ in range(5):
        b = extract("verdigraph_genome", body)
        out.append((b.brain_id, b.content_hash))
    assert len(set(out)) == 1  # all identical


def test_byte_diff_breaks_the_id():
    """One trailing space anywhere in the input must change the brain_id."""
    a = b'{"agent_name":"x","purpose":"y","initial_nodes":["a"],"fitness_metrics":["task_success_rate"]}'
    b = b'{"agent_name":"x","purpose":"y","initial_nodes":["a "],"fitness_metrics":["task_success_rate"]}'
    assert extract("verdigraph_genome", a).brain_id != extract("verdigraph_genome", b).brain_id


def test_format_detection():
    assert detect_format(b'{"agent_name":"x","initial_nodes":["a"]}') == "verdigraph_genome"
    assert detect_format(b'{"tools":[{"type":"code_interpreter"}]}') == "openai_assistant"
    assert detect_format(b'{"instructions":"do x","knowledge":[]}') == "claude_project_export"
    assert detect_format(b'first prompt\nsecond prompt') == "prompt_list"


def test_invariants_all_fire_and_overall_excludes_advisory_i9():
    body = b'{"agent_name":"unwired","purpose":"y","initial_nodes":["a"],"fitness_metrics":["unwired_metric_xyz123"],"llm_bindings":[{"provider":"any"}]}'
    brain = extract("verdigraph_genome", body)
    report = verify_brain(brain)
    ids = [c.id for c in report.checks]
    assert "I9_fitness_metric_wired" in ids
    i9 = next(c for c in report.checks if c.id == "I9_fitness_metric_wired")
    assert i9.advisory is True
    assert i9.passed is False  # the metric is unwired
    # but report overall stays True because advisory invariants don't count
    assert report.passed is True
    assert len(report.checks) == 9  # I1..I9; Python dataclasses subsume the TS 'schema' check at construction


def test_i8_passed_with_default_fires_when_auto_defaulted():
    body = b'{"agent_name":"x","purpose":"y","initial_nodes":["a"],"fitness_metrics":["task_success_rate"]}'
    brain = extract("verdigraph_genome", body)
    report = verify_brain(brain)
    i8 = next(c for c in report.checks if c.id == "I8_llm_bindings")
    assert i8.passed is True
    assert i8.passed_with_default is True


def test_canonicalize_handles_integer_valued_floats_like_js():
    """1.0 must serialize as `1`, not `1.0`, to match JS Number.toString."""
    assert canonicalize({"x": 1.0}) == '{"x":1}'
    assert canonicalize({"x": 0.5}) == '{"x":0.5}'
    assert canonicalize({"x": 1.5, "y": 2.0}) == '{"x":1.5,"y":2}'


def test_canonicalize_sorts_keys_recursively():
    out = canonicalize({"b": {"d": 1, "c": 2}, "a": [3, 1, 2]})
    assert out == '{"a":[3,1,2],"b":{"c":2,"d":1}}'


def test_prompt_list_extractor_runs():
    brain = extract("prompt_list", b"first prompt\nsecond prompt\nthird prompt")
    report = verify_brain(brain)
    assert report.passed
    assert len(brain.nodes) >= 3


def test_to_dict_round_trip_includes_brain_uri():
    brain = extract("verdigraph_genome", b'{"agent_name":"x","purpose":"y","initial_nodes":["a"],"fitness_metrics":["task_success_rate"]}')
    d = to_dict(brain)
    assert d["brain_uri"] == "verdigraph://brain/" + brain.brain_id
