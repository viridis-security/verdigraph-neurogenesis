"""Keeps docs/CANONICALIZATION.md honest.

The document prints a reference implementation and test vectors. These tests run
that printed code and check that it, the library and the documented vectors all
agree, so the published spec cannot drift from what the builder computes.
"""

import hashlib
import json
import re
from pathlib import Path

import pytest

import verdigraph.brain as vb

DOC = Path(__file__).resolve().parent.parent / "docs" / "CANONICALIZATION.md"

V1 = b'{"agent_name":"canon_test","purpose":"canonicalization test vector","initial_nodes":["a","b"],"fitness_metrics":["task_success_rate"],"llm_bindings":[{"provider":"any","required_tools":[],"context_tokens":0}]}'
V2 = b'{"agent_name":"x","purpose":"y","initial_nodes":["a"],"fitness_metrics":["task_success_rate"]}'
V3 = json.dumps(json.loads(V2), indent=2).encode()

# (input, brain_id, input_sha256, content_hash, nodes, edges): verified against verdigraph.dev on 2026-10-23.
VECTORS = {
    "V1": (V1, "5NNT47V850QW9M0V6HF1M5MQDA", "62dc5d4c34ddb196d336115ac320bd005e4f68c3ef334bf2c5adafd6033bab3a",
           "b00613ad30b1e0ca0f3ba75f1b7bca58e861caf2b9e3d7a8fde6f4b141a09f0f", 5, 6),
    "V2": (V2, "RMX124YY916WP0TCSEHFYX7M30", "026b5e2ed0bffb38d51ae5a1aea51f19d068471d5f4a0b8a6da528c8be2c6184",
           "20b9e5be0e5a0d34e564df6d0a554b1232ff9cc3ff309ab8da77a97756602c0c", 4, 3),
    "V3": (V3, "Z8NMF1G6PC28FKNP7GBDNV3PD9", "3d8777c10ec9bea4e2b56dde2dcfecdad970c02af4246b6bcafba414f34add37",
           "1d60c1d448437ac8161a9e8b629c83d0f504ca5f7e401f4ae24b4f21937b73fb", 4, 3),
}


@pytest.fixture(scope="module")
def doc_text() -> str:
    return DOC.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def reference(doc_text):
    """Execute the Python reference implementation exactly as printed in the doc."""
    match = re.search(r"<!-- reference-implementation:python -->\s*```python\n(.*?)```", doc_text, re.S)
    assert match, "reference implementation block not found in docs/CANONICALIZATION.md"
    namespace: dict = {}
    exec(compile(match.group(1), str(DOC), "exec"), namespace)  # noqa: S102 - our own document
    return namespace


@pytest.mark.parametrize("name", sorted(VECTORS))
def test_library_reproduces_documented_vector(name, doc_text):
    data, brain_id, input_sha, content_hash, nodes, edges = VECTORS[name]
    brain = vb.extract("verdigraph_genome", data)
    assert brain.brain_id == brain_id
    assert brain.provenance.input_sha256 == input_sha == hashlib.sha256(data).hexdigest()
    assert brain.content_hash == content_hash
    assert (len(brain.nodes), len(brain.edges)) == (nodes, edges)
    for value in (brain_id, input_sha, content_hash):
        assert value in doc_text, f"{name}: {value} missing from the doc's vector table"
    assert data.decode() in doc_text, f"{name}: the doc does not print this vector's exact input"


@pytest.mark.parametrize("name", sorted(VECTORS))
def test_printed_reference_implementation_reproduces_real_hashes(name, reference):
    data, brain_id, _, content_hash, _, _ = VECTORS[name]
    brain = vb.extract("verdigraph_genome", data)
    assert reference["brain_id"](data) == brain_id
    assert reference["content_hash"](vb.to_dict(brain)) == content_hash


def test_reference_writes_integer_valued_floats_like_javascript(reference):
    assert reference["canonicalize"]({"b": 1.0, "a": [0.5, 2.0, True, None]}) == '{"a":[0.5,2,true,null],"b":1}'


def test_naive_canonicalizer_gets_real_brains_wrong():
    """The pitfall the doc warns about: printing 1.0 as "1.0" changes every brain's hash."""
    brain = vb.extract("verdigraph_genome", V1)
    body = {k: v for k, v in vb.to_dict(brain).items() if k not in ("content_hash", "brain_uri")}

    def naive(v):
        if isinstance(v, dict):
            return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + naive(v[k]) for k in sorted(v)) + "}"
        if isinstance(v, list):
            return "[" + ",".join(naive(x) for x in v) + "]"
        return json.dumps(v, ensure_ascii=False)

    assert hashlib.sha256(naive(body).encode()).hexdigest() != brain.content_hash


def test_reformatting_a_genome_changes_its_identity():
    """Identifiers are byte-addressed: V3 is V2 pretty-printed and gets a different brain_id."""
    assert json.loads(V2) == json.loads(V3)
    assert vb.extract("verdigraph_genome", V2).brain_id != vb.extract("verdigraph_genome", V3).brain_id
