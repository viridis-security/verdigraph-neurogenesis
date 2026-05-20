// tests/brainbuilder/attest.test.ts — Ed25519 sign/verify + invariant gating.

import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import { extract } from "../../src/brainbuilder/extractors";
import {
  buildAttestationBody, signAttestation, verifyAttestation,
  importPrivateKeyFromRaw, importPublicKeyFromRaw, pubkeyFingerprint,
} from "../../src/brainbuilder/attest";

// Ensure global crypto is Node's WebCrypto (Node 20+ exposes it by default; this guards older nodes).
if (typeof (globalThis as any).crypto === "undefined") (globalThis as any).crypto = webcrypto;

const enc = (s: string) => new TextEncoder().encode(s);
const SAMPLE = JSON.stringify({
  agent_name: "x", purpose: "test",
  initial_nodes: ["planner", "executor"],
  fitness_metrics: ["task_success_rate"],
  llm_bindings: [{ provider: "anthropic" }],
});

async function genKeys() {
  // Ed25519 keygen via SubtleCrypto, export raw 32-byte priv+pub.
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey) as ArrayBuffer);
  const spki  = new Uint8Array(await crypto.subtle.exportKey("spki",  kp.publicKey) as ArrayBuffer);
  // The raw 32 bytes are the last 32 bytes of each envelope.
  const priv  = pkcs8.slice(pkcs8.length - 32);
  const pub   = spki.slice(spki.length - 32);
  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return { privHex: hex(priv), pubHex: hex(pub) };
}

describe("attestation Ed25519 sign/verify", () => {
  it("round-trips through importPrivateKeyFromRaw + signAttestation + verifyAttestation", async () => {
    const { privHex, pubHex } = await genKeys();
    const brain = await extract("verdigraph_genome", enc(SAMPLE));
    const body = await buildAttestationBody({
      brain, attestationId: "01ABCDEFGHJKMNPQRSTVWXYZAB",
      tier: "standard", serverVersion: "0.2.0", pubkeyHex: pubHex,
    });
    const privKey = await importPrivateKeyFromRaw(privHex);
    const pubKey  = await importPublicKeyFromRaw(pubHex);
    const signature_b64 = await signAttestation(body, privKey);
    const ok = await verifyAttestation({ body, signature_b64, pubkey_url: "x" }, pubKey);
    expect(ok).toBe(true);
  });

  it("detects tampering with the body", async () => {
    const { privHex, pubHex } = await genKeys();
    const brain = await extract("verdigraph_genome", enc(SAMPLE));
    const body = await buildAttestationBody({
      brain, attestationId: "01ABCDEFGHJKMNPQRSTVWXYZAB",
      tier: "standard", serverVersion: "0.2.0", pubkeyHex: pubHex,
    });
    const privKey = await importPrivateKeyFromRaw(privHex);
    const pubKey  = await importPublicKeyFromRaw(pubHex);
    const signature_b64 = await signAttestation(body, privKey);
    const tampered = { ...body, issued_at: new Date(0).toISOString() };
    const ok = await verifyAttestation({ body: tampered, signature_b64, pubkey_url: "x" }, pubKey);
    expect(ok).toBe(false);
  });

  it("detects tampering with the signature", async () => {
    const { privHex, pubHex } = await genKeys();
    const brain = await extract("verdigraph_genome", enc(SAMPLE));
    const body = await buildAttestationBody({
      brain, attestationId: "01ABCDEFGHJKMNPQRSTVWXYZAB",
      tier: "standard", serverVersion: "0.2.0", pubkeyHex: pubHex,
    });
    const privKey = await importPrivateKeyFromRaw(privHex);
    const pubKey  = await importPublicKeyFromRaw(pubHex);
    const signature_b64 = await signAttestation(body, privKey);
    // flip one bit in the b64-decoded signature
    const flipped = Buffer.from(signature_b64, "base64");
    flipped[0] = flipped[0]! ^ 0x01;
    const ok = await verifyAttestation({ body, signature_b64: flipped.toString("base64"), pubkey_url: "x" }, pubKey);
    expect(ok).toBe(false);
  });

  it("C3: refuses to build a standard attestation when an invariant fails", async () => {
    const { pubHex } = await genKeys();
    const brain = await extract("verdigraph_genome", enc(SAMPLE));
    // Force a tamper that breaks I5_content_hash.
    const broken = { ...brain, content_hash: "0".repeat(64) };
    await expect(buildAttestationBody({
      brain: broken as any, attestationId: "X", tier: "standard", serverVersion: "0.2.0", pubkeyHex: pubHex,
    })).rejects.toThrow(/attestation_refused/);
  });

  it("preview tier returns a body even when invariants fail (no signature)", async () => {
    const { pubHex } = await genKeys();
    const brain = await extract("verdigraph_genome", enc(SAMPLE));
    const broken = { ...brain, content_hash: "0".repeat(64) };
    const body = await buildAttestationBody({
      brain: broken as any, attestationId: "X", tier: "preview", serverVersion: "0.2.0", pubkeyHex: pubHex,
    });
    expect(body.tier).toBe("preview");
    expect(body.invariants.passed).toBe(false);
  });

  it("pubkeyFingerprint is deterministic", async () => {
    const a = await pubkeyFingerprint("00".repeat(32));
    const b = await pubkeyFingerprint("00".repeat(32));
    expect(a).toBe(b);
    expect(a.length).toBe(16);
  });
});
