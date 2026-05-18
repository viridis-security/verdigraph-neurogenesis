// src/verdigraph/dev_ledger.ts — TS port of verdigraph/ledger.py.
//
// IMPORTANT: This is the *developmental* ledger (graph evolution events).
// It is distinct from src/billing/ledger.ts which is the billing usage_ledger.
// Developmental ledger lives in DO state; billing ledger lives in D1.

import { utcNow } from "./graph";

export interface LedgerEvent {
  event_type: string;
  reason: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export class DevelopmentalLedger {
  events: LedgerEvent[] = [];

  record(event_type: string, reason: string, payload: Record<string, unknown> = {}): LedgerEvent {
    const e: LedgerEvent = { event_type, reason, payload, timestamp: utcNow() };
    this.events.push(e);
    return e;
  }

  toList(): LedgerEvent[] {
    return this.events.map((e) => ({ ...e, payload: { ...e.payload } }));
  }
}
