# brain.v1 identifiers, canonical JSON and test vectors

This document describes how a Verdigraph brain artifact is identified and hashed, as implemented by
`verdigraph/brain.py` in this repository and by the hosted builder at verdigraph.dev. The two produce
byte-identical artifacts: every vector below was built locally and on verdigraph.dev on 2026-10-23,
and the results matched field for field.

If this document and `verdigraph/brain.py` ever disagree, the code is the reference.
`tests/test_canonicalization_doc.py` runs the reference implementation printed below against the
vectors, so the build fails if this document drifts.

## Two identifiers with different inputs

| Field | Computed from | Changes when |
|---|---|---|
| `brain_id` | `sha256(input_bytes ‖ ":" ‖ format)`. Each of the first 26 digest bytes maps to one Crockford base32 character, using its low 5 bits | Any byte of the submitted input changes, including whitespace and key order |
| `input_sha256` | `sha256(input_bytes)` | Same as `brain_id` |
| `content_hash` | `sha256(canonical_json(body))` | Anything in the body changes. That includes the input bytes, because the body carries `brain_id` and `provenance`, and `schema_version` |
| `brain_uri` | `"verdigraph://brain/" + brain_id` | Only when `brain_id` changes. It is not part of the hashed body |

The hashed body is `{schema_version, brain_id, genome, nodes, edges, provenance}`. Before hashing,
nodes are sorted by `id` and edges by `(from_node, to_node)`. After that sort, array order is part of
the hash.

### Pin bytes, not files

Both identifiers come from the exact bytes you submit. The same genome serialized two ways gets two
identities: vector V3 below is V2 pretty-printed, and it has a different `brain_id`.

If you keep a genome as pretty-printed JSON in git, pin the identifier of a fixed serialization,
for example `jq -c . genome.json`. Use that same serializer everywhere. Numbers and non-ASCII text
are where serializers usually disagree.

## Canonical JSON

1. Recursively sort every object's keys.
2. Emit no whitespace.
3. Write non-ASCII characters as UTF-8, not `\u` escapes.
4. Format numbers the way JavaScript's `JSON.stringify` does.

Integer-valued floats need care: `1.0` must be written as `1`. Every brain body contains such values
(edges default `token_cost`, `latency_ms` and `risk_score` to `1.0`), so an implementation that
writes `1.0` gets the wrong `content_hash` for every brain.

Key order: Python sorts strings by code point and JavaScript sorts by UTF-16 code unit. The two only
disagree for keys mixing characters above U+FFFF with characters in U+E000–U+FFFF. Keys in brain.v1
bodies are ASCII.

## Reference implementation (Python, standard library only)

<!-- reference-implementation:python -->
```python
import hashlib
import json

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _normalize_for_js(v):
    # Integer-valued floats are written without a decimal point, as JavaScript does.
    if isinstance(v, bool):
        return v
    if isinstance(v, float):
        if v.is_integer() and -1e16 < v < 1e16:
            return int(v)
        return v
    if isinstance(v, list):
        return [_normalize_for_js(x) for x in v]
    if isinstance(v, dict):
        return {k: _normalize_for_js(x) for k, x in v.items()}
    return v


def _sort_value(v):
    if isinstance(v, list):
        return [_sort_value(x) for x in v]
    if isinstance(v, dict):
        return {k: _sort_value(v[k]) for k in sorted(v)}
    return v


def canonicalize(value):
    return json.dumps(_sort_value(_normalize_for_js(value)), separators=(",", ":"), ensure_ascii=False)


def content_hash(brain):
    # `brain` is a full artifact, as produced by verdigraph.brain.to_dict().
    body = {k: v for k, v in brain.items() if k not in ("content_hash", "brain_uri")}
    return hashlib.sha256(canonicalize(body).encode("utf-8")).hexdigest()


def brain_id(input_bytes, fmt="verdigraph_genome"):
    digest = hashlib.sha256(input_bytes + b":" + fmt.encode("utf-8")).digest()
    return "".join(CROCKFORD[b & 0x1F] for b in digest[:26])
```

## Reference implementation (TypeScript)

```typescript
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function sortValue(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(sortValue);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    out[k] = sortValue((v as Record<string, unknown>)[k]);
  }
  return out;
}

export const canonicalize = (v: unknown): string => JSON.stringify(sortValue(v));

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function contentHash(brain: Record<string, unknown>): Promise<string> {
  const { content_hash: _hash, brain_uri: _uri, ...body } = brain;
  const digest = await sha256(new TextEncoder().encode(canonicalize(body)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function brainId(input: Uint8Array, format = "verdigraph_genome"): Promise<string> {
  const suffix = new TextEncoder().encode(":" + format);
  const joined = new Uint8Array(input.length + suffix.length);
  joined.set(input);
  joined.set(suffix, input.length);
  const digest = await sha256(joined);
  return [...digest.slice(0, 26)].map((b) => CROCKFORD[b & 0x1f]).join("");
}
```

## Test vectors

Format `verdigraph_genome`. Inputs are the exact bytes shown, with no trailing newline.

**V1** (209 bytes)

```json
{"agent_name":"canon_test","purpose":"canonicalization test vector","initial_nodes":["a","b"],"fitness_metrics":["task_success_rate"],"llm_bindings":[{"provider":"any","required_tools":[],"context_tokens":0}]}
```

**V2** (94 bytes)

```json
{"agent_name":"x","purpose":"y","initial_nodes":["a"],"fitness_metrics":["task_success_rate"]}
```

**V3** (127 bytes): V2 with two-space indentation.

```json
{
  "agent_name": "x",
  "purpose": "y",
  "initial_nodes": [
    "a"
  ],
  "fitness_metrics": [
    "task_success_rate"
  ]
}
```

| Vector | `brain_id` | `input_sha256` | `content_hash` | Nodes / edges |
|---|---|---|---|---|
| V1 | `5NNT47V850QW9M0V6HF1M5MQDA` | `62dc5d4c34ddb196d336115ac320bd005e4f68c3ef334bf2c5adafd6033bab3a` | `b00613ad30b1e0ca0f3ba75f1b7bca58e861caf2b9e3d7a8fde6f4b141a09f0f` | 5 / 6 |
| V2 | `RMX124YY916WP0TCSEHFYX7M30` | `026b5e2ed0bffb38d51ae5a1aea51f19d068471d5f4a0b8a6da528c8be2c6184` | `20b9e5be0e5a0d34e564df6d0a554b1232ff9cc3ff309ab8da77a97756602c0c` | 4 / 3 |
| V3 | `Z8NMF1G6PC28FKNP7GBDNV3PD9` | `3d8777c10ec9bea4e2b56dde2dcfecdad970c02af4246b6bcafba414f34add37` | `1d60c1d448437ac8161a9e8b629c83d0f504ca5f7e401f4ae24b4f21937b73fb` | 4 / 3 |

## Invariant checks as implemented

| Check | What passing means |
|---|---|
| `schema` | The artifact matches the brain.v1 schema. |
| `I1_node_purpose` | Every node has a non-empty description. Genome-format nodes get a generated description (`Initial cognitive node: <id>`), so for that format this check always passes. It carries information for imported formats with real content. |
| `I2_edge_endpoints` | Every edge references existing node ids. |
| `I3_size_limits` | Node and edge counts are within the genome's growth limits. |
| `I4_protected_present` | The protected nodes named in the safety axioms exist. |
| `I5_content_hash` | `content_hash` matches the canonical body. |
| `I6_known_format` | The provenance format is a supported extractor. |
| `I7_initial_nodes_present` | Every genome `initial_nodes` entry exists in the node set. |
| `I8_llm_bindings` | At least one LLM binding is present. `passed_with_default` is set when the builder supplied `provider: "any"`. |
| `I9_fitness_metric_wired` (advisory) | Each fitness metric appears, case-insensitively, in some node's id, type, description or metadata. This is a name match. It does not show that anything measures the metric. |

## Versioning

brain.v1 is the only schema version. A brain.v2 cutover was announced for 2026-11-19 and deferred on
2026-10-23. Until a new date is announced here, I9 stays advisory, and no identifier or hash changes
because of a schema version change.
