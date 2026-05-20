// src/brainbuilder/attest_storage.ts — persist signed attestations to R2 + D1.

import type { Env } from "../index";
import type { AttestationTier, SignedAttestation } from "./attest";

function r2Key(id: string): string { return `attestations/${id}.json`; }

export interface AttestationRow {
  attestation_id: string;
  brain_id:       string;
  content_hash:   string;
  tier:           AttestationTier;
  issuer:         string;
  issued_at:      number;
  server_version: string;
  signature_b64:  string;
  body_r2_key:    string;
  buyer_caller_id: string | null;
  stripe_session_id: string | null;
}

export async function saveAttestation(env: Env, signed: SignedAttestation, buyerCallerId: string | null, stripeSessionId: string | null): Promise<void> {
  const json = JSON.stringify(signed);
  await env.STATE_BUCKET.put(r2Key(signed.body.attestation_id), json, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  await env.DB.prepare(
    `INSERT INTO attestations (attestation_id, brain_id, content_hash, tier, issuer, issued_at, server_version, signature_b64, body_r2_key, buyer_caller_id, stripe_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(attestation_id) DO NOTHING`
  ).bind(
    signed.body.attestation_id, signed.body.brain.brain_id, signed.body.brain.content_hash,
    signed.body.tier, signed.body.issuer, Date.now(), signed.body.server_version,
    signed.signature_b64, r2Key(signed.body.attestation_id), buyerCallerId, stripeSessionId,
  ).run();
}

export async function loadAttestation(env: Env, attestationId: string): Promise<SignedAttestation | null> {
  const obj = await env.STATE_BUCKET.get(r2Key(attestationId));
  if (!obj) return null;
  const text = await obj.text();
  return JSON.parse(text) as SignedAttestation;
}

export async function findExisting(env: Env, brain_id: string, content_hash: string, tier: AttestationTier): Promise<AttestationRow | null> {
  return await env.DB.prepare(
    `SELECT * FROM attestations WHERE brain_id = ? AND content_hash = ? AND tier = ? LIMIT 1`
  ).bind(brain_id, content_hash, tier).first<AttestationRow>();
}

export async function getAttestationRow(env: Env, attestationId: string): Promise<AttestationRow | null> {
  return await env.DB.prepare(`SELECT * FROM attestations WHERE attestation_id = ?`).bind(attestationId).first<AttestationRow>();
}
