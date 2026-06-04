# Canonicalization & Content Addressing

> Normative reference for the byte-level contract shared by the Python core
> (`verdigraph/brain.py`) and the TypeScript Worker (`hosted-mcp/src/verdigraph/`).
> The two implementations MUST produce identical bytes for identical inputs.
> This contract is locked by `tests/test_brain_parity.py` (via `extract`) and
> `hosted-mcp/tests/parity.test.ts`. Any divergence ships as a deliberate
> schema bump, never a silent fix.

## 1. Canonical JSON (`canonicalize`)

`canonicalize(value)` produces canonical JSON matching JavaScript
`JSON.stringify` byte-for-byte:

1. **JS number normalization** — walk the structure once; any float whose
   value is an integer (and within ±1e16) is coerced to an integer, because
   `Number.prototype.toString()` writes integer-valued floats with no decimal
   point (`1.0` → `1`, `0.0` → `0`). Booleans are exempt from this coercion.
2. **Recursive key sort** — every object's keys are sorted lexicographically
   (code-point order), recursively. Array order is preserved.
3. **Compact serialization** — `json.dumps(..., separators=(",", ":"),
   ensure_ascii=False)`: no whitespace, UTF-8 preserved (no `\uXXXX` escaping
   of non-ASCII).

Only `null`, booleans, numbers, strings, arrays, and objects are
serializable; anything else raises `TypeError`.

Python reference: `verdigraph/brain.py::canonicalize`, `_normalize_for_js`,
`_sort_value`.

## 2. `brain_id` (`derive_brain_id`)

Derived from the **raw input bytes**, before any parsing:

```
digest = sha256(input_bytes || ":" || format_utf8)
brain_id[i] = CROCKFORD[ digest[i mod 32] & 0x1f ]   for i in 0..25
```

26 characters of Crockford base32 (alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`),
each selecting the low 5 bits of a digest byte, cycling through the 32-byte
digest. Same input bytes + same format string → same `brain_id`, in Python and
in the Worker.

`brain_uri = "verdigraph://brain/" + brain_id`.

## 3. `content_hash`

Computed over the canonical form of the **built brain body**, excluding the
self-referential fields:

```
body          = to_dict(brain) minus {"content_hash", "brain_uri"}
content_hash  = sha256_hex( canonicalize(body).encode("utf-8") )
```

Invariant **I5** re-derives this hash at verify time and fails the build if it
does not match.

## 4. Golden parity vector

The minimal genome

```json
{"agent_name":"x","purpose":"y","initial_nodes":["a"],"fitness_metrics":["task_success_rate"]}
```

(exact bytes, no trailing newline) with format `verdigraph_genome` MUST yield:

- `brain_id` = `RMX124YY916WP0TCSEHFYX7M30`
- `content_hash` = `20b9e5be0e5a0d34e564df6d0a554b1232ff9cc3ff309ab8da77a97756602c0c`

Both test suites assert this vector. If either side drifts, CI fails and the
change must be released as a schema bump.
