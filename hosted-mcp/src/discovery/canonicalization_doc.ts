// src/discovery/canonicalization_doc.ts — served at /CANONICALIZATION.md.
//
// The exact algorithm used to compute brain.content_hash. This is the spec
// any external implementer needs to verify a Verdigraph attestation OFFLINE
// without round-tripping through /app/import. Per Energy AI brief P2.2.

export const CANONICALIZATION_MD = `# Verdigraph brain.v1 — Canonical JSON & content_hash

\`\`\`
content_hash := sha256_hex( canonical_json( brain_body_minus_content_hash ) )
\`\`\`

## Canonical JSON rule (single sentence)

Apply \`JSON.stringify\` (RFC 8259) after recursively sorting every object's
keys lexicographically by codepoint. Arrays preserve their existing order.
No whitespace. No trailing newline. UTF-8 encoded before hashing.

## Pseudocode

\`\`\`
function canonicalize(v):
  if v is null or boolean or number or string: return JSON.stringify(v)
  if v is array: return "[" + canonicalize(v[0]) + "," + ... + "]"
  if v is object:
    keys = sorted(keys(v), lexicographic by codepoint)
    return "{" + ('"' + k + '":' + canonicalize(v[k]) for k in keys, joined by ",") + "}"

function content_hash(brain):
  body = { ...brain }   // shallow copy
  delete body.content_hash
  bytes = utf8_encode(canonicalize(body))
  return hex(sha256(bytes))
\`\`\`

## Notes

- **Number formatting** matches V8/JavaScriptCore \`JSON.stringify\`. Integers
  have no decimal; floats use shortest-round-trip representation. If your
  language formats numbers differently (Python's \`json.dumps\` may differ on
  edge cases like \`-0.0\` or trailing zeros), prefer always serializing
  numbers as their JavaScript \`JSON.stringify\` form.
- **Array order is meaningful.** \`nodes\` and \`edges\` are sorted into a
  canonical order BEFORE being included in the body (nodes by id; edges by
  \`(from_node, to_node)\` lexicographically). After that sort, the array
  order is part of the hash.
- **Build is deterministic** at the extractor layer too. Identical input
  bytes always produce identical (brain_id, content_hash). \`built_at\`
  defaults to \`"1970-01-01T00:00:00.000Z"\` and node \`created_at\` defaults
  to the same; evolution events later stamp real ISO times.

## Reference implementations

### TypeScript / JavaScript (matches the Worker)

\`\`\`typescript
function canonicalize(v: unknown): string {
  return JSON.stringify(sortValue(v));
}
function sortValue(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(sortValue);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    out[k] = sortValue((v as Record<string, unknown>)[k]);
  }
  return out;
}
async function contentHash(brain: Record<string, unknown>): Promise<string> {
  const { content_hash: _omit, ...rest } = brain;
  const bytes = new TextEncoder().encode(canonicalize(rest));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
\`\`\`

### Python 3

\`\`\`python
import json, hashlib

def canonicalize(v):
    if isinstance(v, (dict,)):
        return "{" + ",".join(
            json.dumps(k, ensure_ascii=False) + ":" + canonicalize(v[k])
            for k in sorted(v.keys())
        ) + "}"
    if isinstance(v, list):
        return "[" + ",".join(canonicalize(x) for x in v) + "]"
    return json.dumps(v, ensure_ascii=False)

def content_hash(brain: dict) -> str:
    body = {k: v for k, v in brain.items() if k != "content_hash"}
    return hashlib.sha256(canonicalize(body).encode("utf-8")).hexdigest()
\`\`\`

## Signed test vector

Input genome (verdigraph_genome format, 234 bytes):

\`\`\`json
{"agent_name":"canon_test","purpose":"canonicalization test vector","initial_nodes":["a","b"],"fitness_metrics":["task_success_rate"],"llm_bindings":[{"provider":"any","required_tools":[],"context_tokens":0}]}
\`\`\`

Expected after \`POST /app/import\`:

| Field | Value |
|---|---|
| \`preview.brain_id\` | \`(matches sha-derived; verify by re-hashing yourself)\` |
| \`preview.content_hash\` | \`(matches sha-derived; verify by re-hashing yourself)\` |
| \`invariants.passed\` | \`true\` |

To regenerate: \`curl -X POST https://verdigraph.dev/app/import -H 'content-type: application/json' -d '{"format":"verdigraph_genome","content":"...input above..."}'\`

If your local content_hash disagrees with the server's, the most likely cause
is a key-sort or number-formatting drift. Inspect the canonical body of the
divergent record (server reports it under \`provenance\` on \`brain_verify\`)
and compare byte-for-byte.

## Node taxonomy (iter3 P1.6)

Each \`node_ids[].type\` value is drawn from a closed enum. Future schema
versions can add rows; removals require a schema version bump. As of
\`brain.v1\`:

| type           | semantics                                                                | introduced |
|----------------|---------------------------------------------------------------------------|------------|
| \`module\`        | A cognitive routing module (planner, executor, summarizer, etc.).         | brain.v1   |
| \`infrastructure\`| A protected node — safety_checker, evaluation_engine, ledger.             | brain.v1   |
| \`directive\`     | A system-instruction node carrying agent-level guidance.                  | brain.v1   |
| \`knowledge\`     | A retrieval/reference node (file attachments, knowledge-base entries).    | brain.v1   |
| \`tool\`          | An external-tool binding (function name, MCP tool, code interpreter).     | brain.v1   |
| \`prompt\`        | A literal-prompt node (when reconstructing from a flat prompt list).      | brain.v1   |

Implementers SHOULD treat any unknown type as \`module\` for routing
purposes but MUST preserve the original value when round-tripping the
artifact through canonicalization.

## Enforcement plan (iter3 P0.3)

This section formally starts the deprecation clock for the advisory
\`I9_fitness_metric_wired\` invariant.

**Status today (brain.v1):** I9 is advisory. \`invariants.passed\` does NOT
drop when I9 fails; the failure surfaces as an amber line in the Warnings
sidebar so creators can remediate without breaking purchase or attestation
flows.

**Cutover date: 2026-11-19** (six months from iter3 ship). At brain.v2
release on or after that date, \`I9_fitness_metric_wired\` becomes an
ENFORCING invariant. Brains that fail I9 at brain.v2 will:

- Fail \`brain_verify\` (overall \`passed: false\`).
- Be refused attestation purchase (already today's behavior for any failed
  invariant under \`brain_attest_purchase\`).
- Continue to be importable via \`/app/import\` — extraction does not
  fail, only verification does. This is intentional so creators can use the
  endpoint as their lint surface for the upcoming cutover.

**Wiring rule** (the I9 check itself does not change): a declared
\`fitness_metric\` counts as wired if its string appears in:

- any \`nodes[].id\` or \`nodes[].description\`, OR
- any \`nodes[].metadata\` JSON (case-insensitive substring), OR
- any \`growth_rules[].trigger.metric\` (when present in genome).

### Worked example — \`claude_viridis_partner\`

The canonical first-user brain declares five fitness metrics. Under the
brain.v2 enforcement rule, each metric is evaluated as follows
(string-wise, case-insensitive against the union of node id/description/metadata):

| fitness_metric                  | wired to                                 | status (today / v2) |
|---------------------------------|------------------------------------------|---------------------|
| \`task_success_rate\`             | \`evaluation_engine\` node, ledger logs    | wired ✓             |
| \`spec_invariance_compliance\`    | \`safety_checker\` node (audit hook)        | wired ✓             |
| \`autonomous_execution_rate\`     | (advisory failure today; no node mentions it) | UNWIRED — fix needed |
| \`spec_drift_detected\`           | (advisory failure today; no node mentions it) | UNWIRED — fix needed |
| \`partner_satisfaction\`          | (advisory failure today; no node mentions it) | UNWIRED — fix needed |

Migration diff to make \`claude_viridis_partner\` brain.v2-clean (the
genome edit that pre-empts the cutover):

\`\`\`diff
   "initial_nodes": [
     "planner", "executor", "summarizer", "evaluation_engine",
-    "ledger", "safety_checker", "memory", "router",
+    "ledger", "safety_checker", "memory", "router",
+    "autonomy_monitor",              // wires autonomous_execution_rate
+    "drift_detector",                // wires spec_drift_detected
+    "partner_feedback_collector",    // wires partner_satisfaction
     "compute_optimizer", "result_publisher", "feedback_collector"
   ]
\`\`\`

After this edit, \`I9_fitness_metric_wired\` flips from advisory-failing
to passing. The genome bytes change → a new \`brain_id\` is minted (this
is the deliberate \`claude_viridis_partner.v2.genome.json\` Energy AI
committed to in iter3 lockstep). The original brain remains valid in
brain.v1 forever; the v2 genome is the recommended migration target for
the cutover.

### Migration tool stub (iter4)

\`brain_v2_migration\` (advisory MCP tool, docketed for iter4): takes a
brain_id, returns the genome-edit diff that would make it brain.v2-clean
without changing semantics. Same I9-wiring rule as above plus any other
v1→v2 deltas surfaced by then.

## Versioning

This document describes \`brain.v1\`. A schema bump to \`brain.v2\` would
explicitly state which canonicalization fields changed (e.g. number-format,
key-sort locale). Until then, every \`brain.v1\` artifact issued by
verdigraph.dev is verifiable using exactly the rules above.
`;
