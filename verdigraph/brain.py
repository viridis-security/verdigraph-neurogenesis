"""
verdigraph/brain.py — deterministic brain-build pipeline (Python).

This module mirrors the brain.v1 contract implemented by the TypeScript Worker
at verdigraph.dev. Identical input bytes → identical brain_id + content_hash
across both implementations. The canonicalization rule is documented in
/CANONICALIZATION.md on the hosted service and in docs/CANONICALIZATION.md
in this repo.

Public surface:
    extract(format, input_bytes) -> Brain
    canonicalize(value) -> str
    sha256_hex(data) -> str
    derive_brain_id(input_bytes, format) -> str
    verify_brain(brain) -> InvariantReport
    evolve_brain(brain, events) -> Tuple[Brain, List[GrowthLogEntry]]

No external dependencies — stdlib only.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Tuple

# ─── Constants ─────────────────────────────────────────────────────────────

BRAIN_SCHEMA_VERSION = "brain.v1"
FIXED_EPOCH = "1970-01-01T00:00:00.000Z"
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

SUPPORTED_FORMATS = (
    "verdigraph_genome",
    "claude_project_export",
    "openai_assistant",
    "prompt_list",
)
BrainInputFormat = Literal["verdigraph_genome", "claude_project_export", "openai_assistant", "prompt_list"]

SUPPORTED_LLM_PROVIDERS = ("anthropic", "openai", "google", "mistral", "local", "any")


# ─── Schema (dataclasses) ──────────────────────────────────────────────────

@dataclass
class LlmBinding:
    provider: str = "any"
    model_hint: Optional[str] = None
    required_tools: List[str] = field(default_factory=list)
    context_tokens: int = 0


@dataclass
class BrainNode:
    id: str
    description: str
    type: str = "module"
    status: str = "active"
    trust_score: float = 0.5
    usage_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    created_at: str = FIXED_EPOCH
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class BrainEdge:
    from_node: str
    to_node: str
    weight: float = 0.5
    plasticity: float = 0.5
    trust_score: float = 0.5
    success_count: int = 0
    failure_count: int = 0
    token_cost: float = 1.0
    latency_ms: float = 1.0
    risk_score: float = 1.0
    decay_rate: float = 0.01
    last_used: str = FIXED_EPOCH
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class BrainGrowthRules:
    create_node_when_task_repeats: int = 5
    strengthen_edge_on_success: float = 0.08
    weaken_edge_on_failure: float = 0.05
    prune_below_weight: float = 0.12
    max_nodes: int = 128
    max_edges: int = 512
    min_events_before_pruning: int = 3
    max_weight: float = 1.0
    min_weight: float = 0.0


@dataclass
class BrainSafetyAxioms:
    protected_nodes: List[str] = field(default_factory=lambda: ["safety_checker", "evaluation_engine", "ledger"])
    require_growth_logging: bool = True
    require_pruning_logging: bool = True
    disallow_hidden_nodes: bool = True
    disallow_pruning_protected_nodes: bool = True
    require_purpose_for_new_nodes: bool = True
    custom: Dict[str, Any] = field(default_factory=dict)


@dataclass
class BrainGenome:
    agent_name: str
    purpose: str
    initial_nodes: List[str]
    fitness_metrics: List[str]
    llm_bindings: List[LlmBinding] = field(default_factory=lambda: [LlmBinding()])
    growth_rules: BrainGrowthRules = field(default_factory=BrainGrowthRules)
    safety_axioms: BrainSafetyAxioms = field(default_factory=BrainSafetyAxioms)


@dataclass
class ExtractorMeta:
    format: str
    input_bytes: int
    input_sha256: str
    extractor: str
    built_at: str = FIXED_EPOCH
    warnings: List[str] = field(default_factory=list)


@dataclass
class Brain:
    schema_version: str
    brain_id: str
    genome: BrainGenome
    nodes: List[BrainNode]
    edges: List[BrainEdge]
    provenance: ExtractorMeta
    content_hash: str

    @property
    def brain_uri(self) -> str:
        return f"verdigraph://brain/{self.brain_id}"


@dataclass
class InvariantCheck:
    id: str
    description: str
    passed: bool
    passed_with_default: Optional[bool] = None
    advisory: Optional[bool] = None
    detail: Optional[str] = None


@dataclass
class InvariantReport:
    brain_id: str
    checks: List[InvariantCheck]
    passed: bool


# ─── Canonicalization (matches the TS implementation exactly) ──────────────

def canonicalize(value: Any) -> str:
    """Canonical JSON matching JavaScript JSON.stringify byte-for-byte.

    Critical: integer-valued floats (1.0, 0.0, etc.) must serialize as integers
    (1, 0) to match JS Number.toString(). The _normalize_for_js step does this
    walk before json.dumps."""
    return json.dumps(_sort_value(_normalize_for_js(value)), separators=(",", ":"), ensure_ascii=False)


def _normalize_for_js(v: Any) -> Any:
    """Walk the structure once, coercing integer-valued floats to ints (matches JS toString)."""
    if isinstance(v, bool):
        return v
    if isinstance(v, float):
        # JS Number.toString writes integer-valued floats with no decimal point.
        if v.is_integer() and -1e16 < v < 1e16:
            return int(v)
        return v
    if isinstance(v, list):
        return [_normalize_for_js(x) for x in v]
    if isinstance(v, dict):
        return {k: _normalize_for_js(val) for k, val in v.items()}
    return v


def _sort_value(v: Any) -> Any:
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, list):
        return [_sort_value(x) for x in v]
    if isinstance(v, dict):
        return {k: _sort_value(v[k]) for k in sorted(v.keys())}
    raise TypeError(f"unserializable value of type {type(v).__name__}")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def derive_brain_id(input_bytes: bytes, format: str) -> str:
    """Same algorithm as the TS Worker: sha256(bytes || ':' || format), Crockford-base32 over 26 chars."""
    combined = input_bytes + b":" + format.encode("utf-8")
    digest = hashlib.sha256(combined).digest()
    out = []
    for i in range(26):
        out.append(CROCKFORD[digest[i % len(digest)] & 0x1f])
    return "".join(out)


# ─── Extractors ────────────────────────────────────────────────────────────

def _slugify(s: str, max_len: int = 48) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:max_len]
    return base or "node"


def _default_safety() -> BrainSafetyAxioms:
    return BrainSafetyAxioms()


def _default_growth() -> BrainGrowthRules:
    return BrainGrowthRules()


def _extract_verdigraph_genome(input_bytes: bytes) -> Tuple[BrainGenome, List[BrainNode], List[BrainEdge], List[str]]:
    try:
        raw = json.loads(input_bytes.decode("utf-8"))
    except Exception as e:
        raise ValueError(f"verdigraph_genome: invalid JSON ({e})")

    initial_nodes = [s for s in (raw.get("initial_nodes") or []) if isinstance(s, str) and s]
    if not initial_nodes:
        raise ValueError("verdigraph_genome: initial_nodes is required and must be non-empty")

    agent_name = (raw.get("agent_name") or "").strip() or "imported_agent"
    purpose = (raw.get("purpose") or "").strip() or "Imported Verdigraph agent (purpose not specified)."
    fitness = [s for s in (raw.get("fitness_metrics") or []) if isinstance(s, str) and s]

    warnings: List[str] = []
    if not fitness:
        warnings.append("fitness_metrics missing; defaulted to ['task_success_rate']")
        fitness = ["task_success_rate"]

    llm_bindings_raw = [b for b in (raw.get("llm_bindings") or []) if isinstance(b, dict) and isinstance(b.get("provider"), str)]
    llm_bindings: List[LlmBinding] = []
    for b in llm_bindings_raw:
        llm_bindings.append(LlmBinding(
            provider=b["provider"],
            model_hint=b.get("model_hint"),
            required_tools=list(b.get("required_tools") or []),
            context_tokens=int(b.get("context_tokens") or 0),
        ))
    if not llm_bindings:
        warnings.append("no llm_bindings declared in input; defaulted to provider='any' (BYO LLM)")
        llm_bindings.append(LlmBinding())

    safety = BrainSafetyAxioms(**{**asdict(_default_safety()), **(raw.get("safety_axioms") or {})})
    growth = BrainGrowthRules(**{**asdict(_default_growth()), **(raw.get("growth_rules") or {})})

    protected_set = set(safety.protected_nodes)
    all_node_ids = list(dict.fromkeys(initial_nodes + safety.protected_nodes))

    nodes: List[BrainNode] = []
    for nid in all_node_ids:
        if nid in initial_nodes:
            nodes.append(BrainNode(id=nid, type="module", description=f"Initial cognitive node: {nid}"))
        else:
            nodes.append(BrainNode(id=nid, type="infrastructure", description=f"Protected infrastructure node: {nid}"))

    edges: List[BrainEdge] = []
    for frm in initial_nodes:
        if frm in protected_set:
            continue
        for to in safety.protected_nodes:
            edges.append(BrainEdge(from_node=frm, to_node=to, weight=0.5))

    genome = BrainGenome(
        agent_name=agent_name, purpose=purpose,
        initial_nodes=initial_nodes, fitness_metrics=fitness,
        llm_bindings=llm_bindings, growth_rules=growth, safety_axioms=safety,
    )
    return genome, nodes, edges, warnings


def _extract_prompt_list(input_bytes: bytes) -> Tuple[BrainGenome, List[BrainNode], List[BrainEdge], List[str]]:
    text = input_bytes.decode("utf-8")
    # Try JSON list; fall back to newline-split.
    items: List[Dict[str, str]] = []
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            for item in parsed:
                if isinstance(item, str):
                    items.append({"role": "user", "content": item})
                elif isinstance(item, dict) and isinstance(item.get("content"), str):
                    items.append({"role": item.get("role") or "user", "content": item["content"]})
    except Exception:
        pass
    if not items:
        for ln in (l.strip() for l in text.splitlines()):
            if ln:
                items.append({"role": "user", "content": ln})

    if not items:
        raise ValueError("prompt_list: no prompts found")

    warnings: List[str] = []
    if len(items) > 64:
        warnings.append(f"truncated to first 64 prompts (got {len(items)})")
        items = items[:64]

    seen: Dict[str, int] = {}
    ordered: List[Tuple[str, Dict[str, str]]] = []
    for i, item in enumerate(items):
        base = f"{item['role']}_{_slugify(item['content'], 32)}"
        nid = base
        n = 1
        while nid in seen:
            n += 1
            nid = f"{base}_{n}"
        seen[nid] = i
        ordered.append((nid, item))

    safety = _default_safety()
    nodes: List[BrainNode] = []
    for idx, (nid, item) in enumerate(ordered):
        nodes.append(BrainNode(
            id=nid,
            description=(item["content"][:200] or "(empty prompt)"),
            type=("directive" if item["role"] == "system" else "prompt"),
            metadata={"role": item["role"], "sequence": idx},
        ))
    for p in safety.protected_nodes:
        nodes.append(BrainNode(id=p, description=f"Protected infrastructure node: {p}", type="infrastructure"))

    edges: List[BrainEdge] = []
    for i in range(1, len(ordered)):
        edges.append(BrainEdge(from_node=ordered[i-1][0], to_node=ordered[i][0], weight=0.6))
    if ordered:
        edges.append(BrainEdge(from_node=ordered[-1][0], to_node="evaluation_engine", weight=0.5))
        edges.append(BrainEdge(from_node="evaluation_engine", to_node="ledger", weight=0.7))
        edges.append(BrainEdge(from_node=ordered[0][0], to_node="safety_checker", weight=0.5))

    genome = BrainGenome(
        agent_name="imported_prompt_list",
        purpose=f"Sequential prompt-driven agent reconstructed from {len(ordered)} prompts.",
        initial_nodes=[nid for nid, _ in ordered],
        fitness_metrics=["task_success_rate"],
        llm_bindings=[LlmBinding()],
        growth_rules=_default_growth(),
        safety_axioms=safety,
    )
    return genome, nodes, edges, warnings


def _extract_claude_project(input_bytes: bytes) -> Tuple[BrainGenome, List[BrainNode], List[BrainEdge], List[str]]:
    try:
        raw = json.loads(input_bytes.decode("utf-8"))
    except Exception as e:
        raise ValueError(f"claude_project_export: invalid JSON ({e})")

    agent_name = (raw.get("name") or "").strip() or "imported_claude_project"
    instructions = (raw.get("instructions") or "").strip()
    knowledge = [k for k in (raw.get("knowledge") or []) if isinstance(k, dict)]
    tools = [t for t in (raw.get("tools") or []) if isinstance(t, dict) and t.get("name")]

    if not instructions and not knowledge and not tools:
        raise ValueError("claude_project_export: expected at least one of instructions/knowledge/tools")

    safety = _default_safety()
    initial: List[str] = []
    nodes: List[BrainNode] = []

    if instructions:
        nodes.append(BrainNode(id="system_instructions", description=instructions[:400], type="directive"))
        initial.append("system_instructions")
    for k in knowledge:
        label = k.get("name") or k.get("title") or "knowledge"
        nid = f"knowledge_{_slugify(label, 32)}"
        desc = (k.get("summary") or k.get("content") or label)[:300]
        nodes.append(BrainNode(id=nid, description=desc, type="knowledge", metadata={"source_label": label}))
        initial.append(nid)
    for t in tools:
        nid = f"tool_{_slugify(t['name'], 32)}"
        desc = (t.get("description") or f"External tool: {t['name']}")[:300]
        nodes.append(BrainNode(id=nid, description=desc, type="tool", metadata={"tool_name": t["name"]}))
        initial.append(nid)
    for p in safety.protected_nodes:
        nodes.append(BrainNode(id=p, description=f"Protected infrastructure node: {p}", type="infrastructure"))

    edges: List[BrainEdge] = []
    if "system_instructions" in initial:
        for nid in initial:
            if nid != "system_instructions":
                edges.append(BrainEdge(from_node="system_instructions", to_node=nid, weight=0.6))
        edges.append(BrainEdge(from_node="system_instructions", to_node="safety_checker", weight=0.7))
    for nid in initial:
        if nid.startswith("knowledge_"):
            edges.append(BrainEdge(from_node=nid, to_node="evaluation_engine", weight=0.4))
        if nid.startswith("tool_"):
            edges.append(BrainEdge(from_node=nid, to_node="ledger", weight=0.5))

    llm = [LlmBinding(provider="anthropic", model_hint=raw.get("model") or "claude-sonnet-4-6")]
    genome = BrainGenome(
        agent_name=agent_name,
        purpose=(instructions[:280] if instructions else f"Claude project '{agent_name}' reconstructed from export."),
        initial_nodes=initial, fitness_metrics=["task_success_rate", "tool_call_success_rate"],
        llm_bindings=llm, growth_rules=_default_growth(), safety_axioms=safety,
    )
    return genome, nodes, edges, []


def _extract_openai_assistant(input_bytes: bytes) -> Tuple[BrainGenome, List[BrainNode], List[BrainEdge], List[str]]:
    try:
        raw = json.loads(input_bytes.decode("utf-8"))
    except Exception as e:
        raise ValueError(f"openai_assistant: invalid JSON ({e})")

    agent_name = (raw.get("name") or "").strip() or "imported_openai_assistant"
    instructions = (raw.get("instructions") or "").strip()
    tools = raw.get("tools") or []
    file_ids = raw.get("file_ids") or []

    if not instructions and not tools and not file_ids:
        raise ValueError("openai_assistant: expected at least one of instructions/tools/file_ids")

    safety = _default_safety()
    initial: List[str] = []
    nodes: List[BrainNode] = []

    if instructions:
        nodes.append(BrainNode(id="system_instructions", description=instructions[:400], type="directive"))
        initial.append("system_instructions")

    for t in tools:
        if not isinstance(t, dict) or not t.get("type"):
            continue
        if t["type"] == "function" and isinstance(t.get("function"), dict) and t["function"].get("name"):
            nid = f"tool_fn_{_slugify(t['function']['name'], 32)}"
            desc = (t["function"].get("description") or f"Function tool: {t['function']['name']}")[:300]
            nodes.append(BrainNode(id=nid, description=desc, type="tool",
                                    metadata={"openai_tool": "function", "function_name": t["function"]["name"]}))
            initial.append(nid)
        else:
            nid = f"tool_{_slugify(t['type'], 24)}"
            if nid not in initial:
                nodes.append(BrainNode(id=nid, description=f"Built-in OpenAI tool: {t['type']}", type="tool",
                                        metadata={"openai_tool": t["type"]}))
                initial.append(nid)

    for fid in file_ids:
        nid = f"file_{_slugify(str(fid), 24)}"
        nodes.append(BrainNode(id=nid, description=f"Attached file (OpenAI file id: {fid})", type="knowledge",
                                metadata={"openai_file_id": fid}))
        initial.append(nid)

    for p in safety.protected_nodes:
        nodes.append(BrainNode(id=p, description=f"Protected infrastructure node: {p}", type="infrastructure"))

    edges: List[BrainEdge] = []
    if "system_instructions" in initial:
        for nid in initial:
            if nid != "system_instructions":
                edges.append(BrainEdge(from_node="system_instructions", to_node=nid, weight=0.6))
        edges.append(BrainEdge(from_node="system_instructions", to_node="safety_checker", weight=0.7))
    for nid in initial:
        if nid.startswith("file_"):
            edges.append(BrainEdge(from_node=nid, to_node="evaluation_engine", weight=0.4))
        if nid.startswith("tool_"):
            edges.append(BrainEdge(from_node=nid, to_node="ledger", weight=0.5))

    llm = [LlmBinding(provider="openai", model_hint=raw.get("model") or "gpt-4o")]
    genome = BrainGenome(
        agent_name=agent_name,
        purpose=(instructions[:280] if instructions else f"OpenAI Assistant '{agent_name}' reconstructed from export."),
        initial_nodes=initial, fitness_metrics=["task_success_rate", "tool_call_success_rate"],
        llm_bindings=llm, growth_rules=_default_growth(), safety_axioms=safety,
    )
    return genome, nodes, edges, []


_EXTRACTORS = {
    "verdigraph_genome":     ("verdigraph_genome.v1",     _extract_verdigraph_genome),
    "claude_project_export": ("claude_project_export.v1", _extract_claude_project),
    "openai_assistant":      ("openai_assistant.v1",      _extract_openai_assistant),
    "prompt_list":           ("prompt_list.v1",           _extract_prompt_list),
}


def detect_format(input_bytes: bytes) -> str:
    """Best-effort format detection — same heuristic as the TS Worker."""
    try:
        parsed = json.loads(input_bytes.decode("utf-8").strip())
        if isinstance(parsed, list):
            return "prompt_list"
        if isinstance(parsed, dict):
            if isinstance(parsed.get("initial_nodes"), list) and isinstance(parsed.get("agent_name"), str):
                return "verdigraph_genome"
            if isinstance(parsed.get("tools"), list) and any(
                isinstance(t, dict) and t.get("type") in ("function", "code_interpreter", "retrieval")
                for t in parsed["tools"]
            ):
                return "openai_assistant"
            if isinstance(parsed.get("instructions"), str):
                return "claude_project_export"
    except Exception:
        pass
    return "prompt_list"


# ─── Assemble + hash ───────────────────────────────────────────────────────

def _sort_brain_body(nodes: List[BrainNode], edges: List[BrainEdge]) -> Tuple[List[BrainNode], List[BrainEdge]]:
    sorted_nodes = sorted(nodes, key=lambda n: n.id)
    sorted_edges = sorted(edges, key=lambda e: (e.from_node, e.to_node))
    return sorted_nodes, sorted_edges


def extract(format: str, input_bytes: bytes) -> Brain:
    """Build a deterministic Brain from raw input bytes. Same output as the TS Worker."""
    if format not in _EXTRACTORS:
        raise ValueError(f"unsupported format: {format}")
    extractor_tag, fn = _EXTRACTORS[format]
    genome, nodes, edges, warnings = fn(input_bytes)
    return _assemble(input_bytes, format, extractor_tag, genome, nodes, edges, warnings)


def _assemble(input_bytes: bytes, format: str, extractor_tag: str,
              genome: BrainGenome, nodes: List[BrainNode], edges: List[BrainEdge],
              warnings: List[str]) -> Brain:
    input_sha = sha256_hex(input_bytes)
    brain_id = derive_brain_id(input_bytes, format)
    nodes, edges = _sort_brain_body(nodes, edges)
    provenance = ExtractorMeta(
        format=format, input_bytes=len(input_bytes), input_sha256=input_sha,
        extractor=extractor_tag, built_at=FIXED_EPOCH, warnings=warnings,
    )
    body = {
        "schema_version": BRAIN_SCHEMA_VERSION,
        "brain_id":       brain_id,
        "genome":         _genome_to_dict(genome),
        "nodes":          [asdict(n) for n in nodes],
        "edges":          [asdict(e) for e in edges],
        "provenance":     asdict(provenance),
    }
    content_hash = sha256_hex(canonicalize(body).encode("utf-8"))
    return Brain(
        schema_version=BRAIN_SCHEMA_VERSION, brain_id=brain_id, genome=genome,
        nodes=nodes, edges=edges, provenance=provenance, content_hash=content_hash,
    )


def _genome_to_dict(g: BrainGenome) -> Dict[str, Any]:
    d = asdict(g)
    # Drop None fields from llm_bindings to match the TS canonical shape exactly.
    for b in d.get("llm_bindings", []):
        if b.get("model_hint") is None:
            b.pop("model_hint", None)
    return d


def to_dict(brain: Brain) -> Dict[str, Any]:
    return {
        "schema_version": brain.schema_version,
        "brain_id":       brain.brain_id,
        "brain_uri":      brain.brain_uri,
        "genome":         _genome_to_dict(brain.genome),
        "nodes":          [asdict(n) for n in brain.nodes],
        "edges":          [asdict(e) for e in brain.edges],
        "provenance":     asdict(brain.provenance),
        "content_hash":   brain.content_hash,
    }


# ─── Invariants ────────────────────────────────────────────────────────────

def verify_brain(brain: Brain) -> InvariantReport:
    checks: List[InvariantCheck] = []

    # I1: every node has a description
    missing = [n.id for n in brain.nodes if not (n.description or "").strip()]
    checks.append(InvariantCheck(
        id="I1_node_purpose", description="Every node has a non-empty description (purpose)",
        passed=not missing, detail=(f"nodes missing purpose: {', '.join(missing)}" if missing else None),
    ))

    # I2: edge endpoints exist
    node_ids = {n.id for n in brain.nodes}
    dangling = [(e.from_node, e.to_node) for e in brain.edges if e.from_node not in node_ids or e.to_node not in node_ids]
    checks.append(InvariantCheck(
        id="I2_edge_endpoints", description="Every edge references existing node ids",
        passed=not dangling,
        detail=(f"dangling edges: {', '.join(f'{a}->{b}' for a,b in dangling)}" if dangling else None),
    ))

    # I3: size limits
    gr = brain.genome.growth_rules
    over_n = len(brain.nodes) > gr.max_nodes
    over_e = len(brain.edges) > gr.max_edges
    checks.append(InvariantCheck(
        id="I3_size_limits", description="Node and edge counts respect genome growth_rules limits",
        passed=not (over_n or over_e),
        detail=(f"nodes={len(brain.nodes)}/{gr.max_nodes} edges={len(brain.edges)}/{gr.max_edges}" if over_n or over_e else None),
    ))

    # I4: protected present
    missing_protected = [p for p in brain.genome.safety_axioms.protected_nodes if p not in node_ids]
    checks.append(InvariantCheck(
        id="I4_protected_present", description="Protected nodes from safety_axioms exist in the node set",
        passed=not missing_protected,
        detail=(f"missing protected nodes: {', '.join(missing_protected)}" if missing_protected else None),
    ))

    # I5: content_hash matches canonical body
    body_for_hash = {k: v for k, v in to_dict(brain).items() if k != "content_hash" and k != "brain_uri"}
    expected = sha256_hex(canonicalize(body_for_hash).encode("utf-8"))
    checks.append(InvariantCheck(
        id="I5_content_hash", description="content_hash matches sha256(canonical(body))",
        passed=(brain.content_hash == expected),
        detail=(f"expected {expected} got {brain.content_hash}" if brain.content_hash != expected else None),
    ))

    # I6: known format
    checks.append(InvariantCheck(
        id="I6_known_format", description="Provenance format is a supported extractor",
        passed=brain.provenance.format in SUPPORTED_FORMATS,
    ))

    # I7: initial nodes present
    initial_missing = [n for n in brain.genome.initial_nodes if n not in node_ids]
    checks.append(InvariantCheck(
        id="I7_initial_nodes_present", description="Genome's initial_nodes all exist in the node set",
        passed=not initial_missing,
        detail=(f"missing initial nodes: {', '.join(initial_missing)}" if initial_missing else None),
    ))

    # I8: llm_bindings
    bindings = brain.genome.llm_bindings or []
    unknown = [b for b in bindings if b.provider not in SUPPORTED_LLM_PROVIDERS]
    auto_defaulted = any("llm_binding" in w.lower() for w in brain.provenance.warnings)
    checks.append(InvariantCheck(
        id="I8_llm_bindings",
        description="At least one llm_binding, all providers recognised (BYO LLM)",
        passed=(len(bindings) > 0 and not unknown),
        passed_with_default=(auto_defaulted and len(bindings) > 0 and not unknown),
        detail=(
            "no llm_bindings declared" if not bindings
            else (f"unknown providers: {', '.join(b.provider for b in unknown)}" if unknown
                  else ("llm_bindings auto-defaulted to provider='any' — declare explicit bindings to remove the default" if auto_defaulted else None))
        ),
    ))

    # I9 ADVISORY: fitness metrics wired
    fitness = brain.genome.fitness_metrics or []
    blob = " ".join(f"{n.id} {n.type} {n.description} {json.dumps(n.metadata)}" for n in brain.nodes).lower()
    unwired = [m for m in fitness if m.lower() not in blob]
    checks.append(InvariantCheck(
        id="I9_fitness_metric_wired",
        description="Each declared fitness_metric maps to at least one node (advisory)",
        passed=not unwired, advisory=True,
        detail=(f"unwired fitness metrics: {', '.join(unwired)}" if unwired else None),
    ))

    overall = all(c.passed for c in checks if not c.advisory)
    return InvariantReport(brain_id=brain.brain_id, checks=checks, passed=overall)


def report_to_dict(r: InvariantReport) -> Dict[str, Any]:
    return {
        "brain_id": r.brain_id, "passed": r.passed,
        "checks": [{k: v for k, v in asdict(c).items() if v is not None or k in ("passed", "id", "description")} for c in r.checks],
    }
