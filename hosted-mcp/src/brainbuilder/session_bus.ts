// src/brainbuilder/session_bus.ts — live MCP build sessions.
//
// Two surfaces feed one session bus:
//   - Browser (human) subscribes to SSE at /app/sessions/:id/events.
//   - Agent (the user's LLM) makes brain.* MCP tool calls with build_session_id.
// Each tool call writes an event into D1 session_events; the SSE handler tails
// the table by polling seq > lastSeq every 500ms. Cloudflare Workers prevent
// long-lived in-memory pub/sub across instances, so D1 is the source of truth.

import type { Env } from "../index";

const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
const PAIRING_CODE_LEN = 8;

function randULID(): string {
  // 26-char Crockford-base32, time-prefixed.
  const t = Date.now();
  const tStr = t.toString(32).toUpperCase().padStart(10, "0");
  const rnd = new Uint8Array(16);
  crypto.getRandomValues(rnd);
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let r = "";
  for (let i = 0; i < 16; i++) r += alphabet[rnd[i]! & 0x1f] ?? "0";
  return (tStr + r).slice(0, 26);
}

function pairingCode(): string {
  const rnd = new Uint8Array(PAIRING_CODE_LEN);
  crypto.getRandomValues(rnd);
  let s = "";
  for (let i = 0; i < PAIRING_CODE_LEN; i++) s += PAIRING_CODE_ALPHABET[rnd[i]! % PAIRING_CODE_ALPHABET.length] ?? "X";
  return s.slice(0, 4) + "-" + s.slice(4);
}

export interface BuildSession {
  session_id:       string;
  pairing_code:     string;
  caller_id:        string | null;
  status:           "awaiting_pair" | "active" | "closed";
  current_brain_id: string | null;
  created_at:       number;
  paired_at:        number | null;
  closed_at:        number | null;
}

export async function createSession(env: Env): Promise<BuildSession> {
  const now = Date.now();
  const session_id   = randULID();
  const pairing_code = pairingCode();
  await env.DB.prepare(
    `INSERT INTO build_sessions (session_id, pairing_code, status, created_at) VALUES (?, ?, 'awaiting_pair', ?)`
  ).bind(session_id, pairing_code, now).run();
  return {
    session_id, pairing_code, caller_id: null,
    status: "awaiting_pair", current_brain_id: null,
    created_at: now, paired_at: null, closed_at: null,
  };
}

export async function getSession(env: Env, session_id: string): Promise<BuildSession | null> {
  const row = await env.DB.prepare(`SELECT * FROM build_sessions WHERE session_id = ?`).bind(session_id).first<any>();
  return row ?? null;
}

export async function getSessionByPairing(env: Env, pairing_code: string): Promise<BuildSession | null> {
  const row = await env.DB.prepare(`SELECT * FROM build_sessions WHERE pairing_code = ?`).bind(pairing_code).first<any>();
  return row ?? null;
}

export async function pairSession(env: Env, pairing_code: string, caller_id: string): Promise<BuildSession> {
  const session = await getSessionByPairing(env, pairing_code);
  if (!session) throw new Error("invalid_pairing_code");
  if (session.status === "closed") throw new Error("session_closed");
  if (session.caller_id && session.caller_id !== caller_id) throw new Error("already_paired_to_different_caller");
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE build_sessions SET caller_id = ?, status = 'active', paired_at = ? WHERE session_id = ?`
  ).bind(caller_id, now, session.session_id).run();
  await emitEvent(env, session.session_id, "note", null, { msg: "agent paired", caller_id });
  return { ...session, caller_id, status: "active", paired_at: now };
}

export async function closeSession(env: Env, session_id: string): Promise<void> {
  await env.DB.prepare(`UPDATE build_sessions SET status='closed', closed_at=? WHERE session_id=?`).bind(Date.now(), session_id).run();
  await emitEvent(env, session_id, "note", null, { msg: "session closed" });
}

export interface SessionEvent {
  event_id:    string;
  session_id:  string;
  seq:         number;
  kind:        "tool_call_start" | "tool_call_result" | "tool_call_error" | "invariant_report" | "note";
  tool:        string | null;
  payload:     Record<string, unknown>;
  occurred_at: number;
}

export async function emitEvent(
  env: Env,
  session_id: string,
  kind: SessionEvent["kind"],
  tool: string | null,
  payload: Record<string, unknown>,
): Promise<SessionEvent> {
  const event_id = randULID();
  const now = Date.now();
  // seq = (max(seq) + 1) per session; D1 is sequential per Worker invocation so a transaction is fine.
  const row = await env.DB.prepare(`SELECT COALESCE(MAX(seq), 0) AS s FROM session_events WHERE session_id = ?`).bind(session_id).first<any>();
  const seq = (row?.s ?? 0) + 1;
  const payloadJson = JSON.stringify(payload);
  await env.DB.prepare(
    `INSERT INTO session_events (event_id, session_id, seq, kind, tool, payload, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(event_id, session_id, seq, kind, tool, payloadJson, now).run();
  return { event_id, session_id, seq, kind, tool, payload, occurred_at: now };
}

export async function listEvents(env: Env, session_id: string, sinceSeq: number, limit = 200): Promise<SessionEvent[]> {
  const rows = await env.DB.prepare(
    `SELECT event_id, session_id, seq, kind, tool, payload, occurred_at
       FROM session_events
      WHERE session_id = ? AND seq > ?
      ORDER BY seq ASC
      LIMIT ?`
  ).bind(session_id, sinceSeq, limit).all<any>();
  return (rows.results ?? []).map((r) => ({
    event_id:    r.event_id,
    session_id:  r.session_id,
    seq:         r.seq,
    kind:        r.kind,
    tool:        r.tool,
    payload:     JSON.parse(r.payload),
    occurred_at: r.occurred_at,
  }));
}
