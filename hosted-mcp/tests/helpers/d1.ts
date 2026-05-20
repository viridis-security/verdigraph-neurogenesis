// tests/helpers/d1.ts — real-SQLite-backed D1Database shim for tests.
//
// Wraps Node's built-in `node:sqlite` (DatabaseSync, Node >= 22.5) in the
// subset of the Cloudflare `D1Database` surface the Worker code actually uses:
//   prepare(sql).bind(...).run() / .first() / .all()   and   batch([...]).
//
// Why a real engine instead of a hand-rolled fake: the money-path invariants we
// are testing (H1 exactly-once metering, H3 atomic batches) depend on UNIQUE
// indexes, CHECK constraints, FOREIGN KEYs and transactional rollback. A real
// SQLite instance enforces all of those for free, so a test that passes here is
// a test that exercises the same constraints D1 enforces in production.
//
// The schema is built by applying the repo's real db/migrations/*.sql in order,
// so the shim never drifts from production DDL.

import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";

// `node:sqlite` is newer than Vite's hard-coded builtin list, so a static
// `import` of it makes Vitest's bundler try (and fail) to resolve a "sqlite"
// package. Loading it through createRequire keeps the reference dynamic so
// Vite never touches it; Node resolves the real builtin at runtime.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncT;
};

const MIGRATIONS_DIR = resolve(__dirname, "..", "..", "db", "migrations");

function normalizeParams(params: unknown[]): unknown[] {
  // D1 (and SQLite) reject `undefined`; the Worker code always coalesces to
  // null, but normalize defensively so a stray undefined fails loudly as null.
  return params.map((p) => (p === undefined ? null : p));
}

interface RunResult {
  success: true;
  results: unknown[];
  meta: { changes: number; last_row_id: number; duration: number };
}

class D1StmtShim {
  constructor(
    private readonly db: DatabaseSyncT,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): D1StmtShim {
    return new D1StmtShim(this.db, this.sql, normalizeParams(params));
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params as any[]));
    return row === undefined ? null : ({ ...(row as object) } as T);
  }

  async all<T = Record<string, unknown>>(): Promise<{
    results: T[];
    success: true;
    meta: { changes: number; duration: number };
  }> {
    const rows = this.db.prepare(this.sql).all(...(this.params as any[]));
    return {
      results: rows.map((r) => ({ ...(r as object) })) as T[],
      success: true,
      meta: { changes: 0, duration: 0 },
    };
  }

  async run(): Promise<RunResult> {
    return this.exec();
  }

  /** Synchronous execution — used internally and by D1Shim.batch(). */
  exec(): RunResult {
    const r = this.db.prepare(this.sql).run(...(this.params as any[]));
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(r.changes),
        last_row_id: Number(r.lastInsertRowid),
        duration: 0,
      },
    };
  }
}

export class D1Shim {
  private readonly db: DatabaseSyncT;

  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.applyMigrations();
  }

  private applyMigrations(): void {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of files) {
      this.db.exec(readFileSync(resolve(MIGRATIONS_DIR, f), "utf8"));
    }
  }

  prepare(sql: string): D1StmtShim {
    return new D1StmtShim(this.db, sql);
  }

  /**
   * D1 batch semantics: all statements run inside a single implicit transaction.
   * If any statement throws, the whole batch rolls back and the error propagates.
   */
  async batch(stmts: D1StmtShim[]): Promise<RunResult[]> {
    this.db.exec("BEGIN");
    try {
      const out = stmts.map((s) => s.exec());
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }

  /** Escape hatch for tests that need raw SQL setup/inspection. */
  raw(): DatabaseSyncT {
    return this.db;
  }
}

/** Build an `Env`-shaped object whose DB is a fresh real-SQLite instance. */
export function makeTestEnv(overrides: Record<string, unknown> = {}): any {
  return {
    DB: new D1Shim(),
    ENVIRONMENT: "test",
    ROUTING_FEE_USD_MICROS: "2000",
    CONSERVATION_RATIO_NUM: "1",
    CONSERVATION_RATIO_DEN: "4",
    ...overrides,
  };
}

/** Insert a minimal valid caller row so FK-constrained inserts succeed. */
export function seedCaller(env: any, callerId: string, oauthSubject?: string): void {
  const now = Date.now();
  env.DB.raw()
    .prepare(
      `INSERT INTO callers (caller_id, display_name, oauth_subject, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(callerId, "test", oauthSubject ?? `sub-${callerId}`, now, now);
}

/** Set a caller's prepaid credit balance directly. */
export function seedBalance(env: any, callerId: string, balanceUsdMicros: number): void {
  env.DB.raw()
    .prepare(
      `INSERT INTO credit_balances (caller_id, balance_usd_micros, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(caller_id) DO UPDATE SET balance_usd_micros = excluded.balance_usd_micros`,
    )
    .run(callerId, balanceUsdMicros, Date.now());
}
