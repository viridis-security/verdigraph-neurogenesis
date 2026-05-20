// src/brainbuilder/attest.ts — Ed25519-signed compliance attestations.
//
// At v0 we keep the signing key entirely server-side as a Worker secret
// (VERDIGRAPH_ATTEST_PRIVKEY, 32-byte raw private scalar in hex). The matching
// public key (32-byte raw, hex) is exposed openly via
//   GET /.well-known/verdigraph-attest-pubkey
// so any holder of a signed attestation can verify it offline forever.
//
// Cloudflare Workers' SubtleCrypto supports Ed25519 (algorithm name "Ed25519");
// importKey expects PKCS#8 (private) or SPKI (public). We wrap the raw 32-byte
// values in the appropriate ASN.1 envelopes here so deployment can store just
// the 64 hex chars.

import type { Env } from "../index";
import { BrainArtifact } from "./schema";
import { canonicalize, sha256Hex } from "./canonicalize";
import { verifyBrain, InvariantReport } from "./invariants";

export const ATTEST_VERSION = "attest.v1";
export const ATTEST_ISSUER  = "Viridis Security";

export type AttestationTier = "preview" | "standard" | "enterprise";

export interface AttestationBody {
  schema_version: string;        // "attest.v1"
  attestation_id: string;
  tier:           AttestationTier;
  issuer:         string;        // "Viridis Security"
  issued_at:      string;        // ISO
  server_version: string;
  brain: {
    brain_id:      string;
    content_hash:  string;
    agent_name:    string;
    node_count:    number;
    edge_count:    number;
    input_format:  string;
    llm_bindings:  unknown;
  };
  invariants: InvariantReport;
  attest_pubkey_fingerprint: string; // sha256(pubkey raw) first 16 hex
}

export interface SignedAttestation {
  body:           AttestationBody;
  signature_b64:  string;
  pubkey_url:     string;
}

// ── ASN.1 envelope helpers for raw Ed25519 keys ──────────────────────────
// Ed25519 PKCS#8: 0x302e020100300506032b657004220420 || raw32
// Ed25519 SPKI:   0x302a300506032b6570032100         || raw32
const PKCS8_PREFIX = new Uint8Array([
  0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,
  0x04,0x22,0x04,0x20,
]);
const SPKI_PREFIX = new Uint8Array([
  0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x03,0x21,0x00,
]);

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error("invalid hex");
  if (hex.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesToB64(b: Uint8Array): string {
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}

export async function importPrivateKeyFromRaw(hex: string): Promise<CryptoKey> {
  const raw = hexToBytes(hex);
  if (raw.length !== 32) throw new Error(`Ed25519 private key must be 32 bytes (got ${raw.length})`);
  const pkcs8 = concat(PKCS8_PREFIX, raw);
  return await crypto.subtle.importKey(
    "pkcs8", pkcs8 as BufferSource, { name: "Ed25519" } as any, false, ["sign"],
  );
}

export async function importPublicKeyFromRaw(hex: string): Promise<CryptoKey> {
  const raw = hexToBytes(hex);
  if (raw.length !== 32) throw new Error(`Ed25519 public key must be 32 bytes (got ${raw.length})`);
  const spki = concat(SPKI_PREFIX, raw);
  return await crypto.subtle.importKey(
    "spki", spki as BufferSource, { name: "Ed25519" } as any, false, ["verify"],
  );
}

export async function pubkeyFingerprint(pubkeyHex: string): Promise<string> {
  const raw = hexToBytes(pubkeyHex);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw as BufferSource));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Build, sign, verify ──────────────────────────────────────────────────

export interface BuildAttestationArgs {
  brain:         BrainArtifact;
  attestationId: string;
  tier:          AttestationTier;
  serverVersion: string;
  pubkeyHex:     string;            // raw 32-byte public key in hex
}

export async function buildAttestationBody(args: BuildAttestationArgs): Promise<AttestationBody> {
  const report = await verifyBrain(args.brain);
  if (args.tier !== "preview" && !report.passed) {
    const failed = report.checks.filter((c) => !c.passed).map((c) => c.id).join(", ");
    throw new Error(`attestation_refused: brain failed invariants [${failed}]`);
  }
  return {
    schema_version: ATTEST_VERSION,
    attestation_id: args.attestationId,
    tier:           args.tier,
    issuer:         ATTEST_ISSUER,
    issued_at:      new Date().toISOString(),
    server_version: args.serverVersion,
    brain: {
      brain_id:     args.brain.brain_id,
      content_hash: args.brain.content_hash,
      agent_name:   args.brain.genome.agent_name,
      node_count:   args.brain.nodes.length,
      edge_count:   args.brain.edges.length,
      input_format: args.brain.provenance.format,
      llm_bindings: args.brain.genome.llm_bindings,
    },
    invariants: report,
    attest_pubkey_fingerprint: await pubkeyFingerprint(args.pubkeyHex),
  };
}

export async function signAttestation(body: AttestationBody, privKey: CryptoKey): Promise<string> {
  const canonical = canonicalize(body);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" } as any, privKey, new TextEncoder().encode(canonical)));
  return bytesToB64(sig);
}

export async function verifyAttestation(signed: SignedAttestation, pubKey: CryptoKey): Promise<boolean> {
  const canonical = canonicalize(signed.body);
  const sig = b64ToBytes(signed.signature_b64);
  return await crypto.subtle.verify({ name: "Ed25519" } as any, pubKey, sig as BufferSource, new TextEncoder().encode(canonical));
}

// ── Server-side integration helpers ──────────────────────────────────────

/** Returns the configured Ed25519 keys, or null if attestation is not provisioned on this Worker. */
export async function getAttestKeys(env: Env): Promise<{ privKey: CryptoKey; pubKey: CryptoKey; pubkeyHex: string } | null> {
  const priv = (env as any).VERDIGRAPH_ATTEST_PRIVKEY as string | undefined;
  const pub  = (env as any).VERDIGRAPH_ATTEST_PUBKEY  as string | undefined;
  if (!priv || !pub) return null;
  return {
    privKey: await importPrivateKeyFromRaw(priv),
    pubKey:  await importPublicKeyFromRaw(pub),
    pubkeyHex: pub,
  };
}

/** Convenience: build + sign + persist for a brain. Returns the signed JSON. */
export async function attestBrain(env: Env, brain: BrainArtifact, tier: AttestationTier, serverVersion: string): Promise<SignedAttestation> {
  const keys = await getAttestKeys(env);
  if (!keys && tier !== "preview") {
    throw new Error("attestation_unavailable: VERDIGRAPH_ATTEST_PRIVKEY/_PUBKEY not configured on this Worker");
  }
  const attestation_id = ulidLike();
  const body = await buildAttestationBody({
    brain,
    attestationId: attestation_id,
    tier,
    serverVersion,
    pubkeyHex: keys?.pubkeyHex ?? "00".repeat(32),
  });
  if (tier === "preview") {
    return { body, signature_b64: "", pubkey_url: "https://verdigraph.dev/.well-known/verdigraph-attest-pubkey" };
  }
  const signature_b64 = await signAttestation(body, keys!.privKey);
  return { body, signature_b64, pubkey_url: "https://verdigraph.dev/.well-known/verdigraph-attest-pubkey" };
}

function ulidLike(): string {
  const t = Date.now().toString(32).toUpperCase().padStart(10, "0");
  const rnd = new Uint8Array(16);
  crypto.getRandomValues(rnd);
  const alpha = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let r = ""; for (let i = 0; i < 16; i++) r += alpha[rnd[i]! & 0x1f] ?? "0";
  return (t + r).slice(0, 26);
}

// ── Enterprise tier: narrative renderer ─────────────────────────────────

/**
 * Render a long-form attestation report (markdown). Standard tier returns the
 * signed JSON only; enterprise tier returns this in addition. No LLM used —
 * fully deterministic from the brain + invariant report.
 */
export function renderEnterpriseNarrative(signed: SignedAttestation): string {
  const b = signed.body;
  const lines: string[] = [];
  lines.push(`# Verdigraph Compliance Attestation — ${b.tier.toUpperCase()}`);
  lines.push("");
  lines.push(`**Attestation ID:** \`${b.attestation_id}\``);
  lines.push(`**Issued:** ${b.issued_at}`);
  lines.push(`**Issuer:** ${b.issuer}`);
  lines.push(`**Server version:** ${b.server_version}`);
  lines.push(`**Public key fingerprint:** \`${b.attest_pubkey_fingerprint}\``);
  lines.push(`**Pubkey URL:** ${signed.pubkey_url}`);
  lines.push("");
  lines.push("## Subject");
  lines.push("");
  lines.push(`- Brain ID: \`${b.brain.brain_id}\``);
  lines.push(`- Content hash (sha256): \`${b.brain.content_hash}\``);
  lines.push(`- Agent name: ${b.brain.agent_name}`);
  lines.push(`- Source format: ${b.brain.input_format}`);
  lines.push(`- Node count: ${b.brain.node_count}`);
  lines.push(`- Edge count: ${b.brain.edge_count}`);
  lines.push("");
  lines.push("## Invariant report");
  lines.push("");
  for (const c of b.invariants.checks) {
    lines.push(`### ${c.passed ? "✅" : "❌"} ${c.id} — ${c.description}`);
    if (c.detail) lines.push(`> ${c.detail}`);
    lines.push("");
  }
  lines.push("## Signature");
  lines.push("");
  lines.push("This attestation is signed with Ed25519. Verify offline using the");
  lines.push("public key at the URL above and the canonical JSON-stringified body.");
  lines.push("");
  lines.push("```");
  lines.push(signed.signature_b64);
  lines.push("```");
  return lines.join("\n");
}
