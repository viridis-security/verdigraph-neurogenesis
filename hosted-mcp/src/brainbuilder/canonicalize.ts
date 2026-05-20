// src/brainbuilder/canonicalize.ts — deterministic JSON serialization + hashing.
//
// The brain build pipeline is required to be reproducible: identical input
// bytes -> identical content_hash. That requires a canonical JSON shape
// (sorted keys, normalized number formatting, stable array ordering for
// nodes/edges before the hash is computed).

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
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

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const data =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash the canonical body of a brain (everything except content_hash itself). */
export async function hashBrainBody(body: Record<string, unknown>): Promise<string> {
  const { content_hash: _omit, ...rest } = body;
  return sha256Hex(canonicalize(rest));
}

/**
 * Deterministic ULID-like id derived from input bytes. Pure function of the
 * input so identical uploads produce identical brain_ids — this is what makes
 * the free "preview" cacheable and the paid build idempotent.
 *
 * Format: 26-char Crockford-base32 from sha256(input_bytes || format).
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export async function deriveBrainId(inputBytes: Uint8Array, format: string): Promise<string> {
  const combined = new Uint8Array(inputBytes.length + format.length + 1);
  combined.set(inputBytes, 0);
  combined.set(new TextEncoder().encode(":" + format), inputBytes.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", combined as BufferSource));
  let out = "";
  for (let i = 0; i < 26; i++) {
    out += CROCKFORD[digest[i % digest.length]! & 0x1f] ?? "0";
  }
  return out;
}
