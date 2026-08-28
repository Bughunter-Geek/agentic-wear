import { DurableObject } from "cloudflare:workers";

type IssuedRow = { pair_id: string };
type CountRow = { count: number };
type BudgetRow = { window_started_at: number; attempt_count: number };

export type CompletionAdmission = { admitted: boolean; rateLimited: boolean };

export class PairAdmission extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  async reserve(pairId: string, expiresAt: number, now: number): Promise<boolean> {
    this.deleteExpired(now);
    if (this.ctx.storage.sql.exec<IssuedRow>(
      "SELECT pair_id FROM issued_pairs WHERE pair_id = ? LIMIT 1",
      pairId,
    ).toArray().length > 0) return false;
    const count = this.ctx.storage.sql.exec<CountRow>("SELECT COUNT(*) AS count FROM issued_pairs").one().count;
    if (count >= this.maxPendingPairs()) throw new PairAdmissionError("Too many pending pairings", 503);
    this.ctx.storage.sql.exec(
      "INSERT INTO issued_pairs (pair_id, expires_at) VALUES (?, ?)",
      pairId,
      expiresAt,
    );
    await this.scheduleCleanup();
    return true;
  }

  async isIssued(pairId: string, now: number): Promise<boolean> {
    this.deleteExpired(now);
    const issued = this.ctx.storage.sql.exec<IssuedRow>(
      "SELECT pair_id FROM issued_pairs WHERE pair_id = ? AND expires_at > ? LIMIT 1",
      pairId,
      now,
    ).toArray().length > 0;
    await this.scheduleCleanup();
    return issued;
  }

  async authorizeCompletion(pairId: string, now: number): Promise<CompletionAdmission> {
    this.deleteExpired(now);
    const windowStartedAt = Math.floor(now / 60_000) * 60_000;
    const budget = this.ctx.storage.sql.exec<BudgetRow>(
      "SELECT window_started_at, attempt_count FROM completion_budget WHERE singleton = 1",
    ).one();
    const attemptCount = budget.window_started_at === windowStartedAt ? budget.attempt_count : 0;
    if (attemptCount >= this.maxCompletionAttempts()) return { admitted: false, rateLimited: true };
    this.ctx.storage.sql.exec(
      "UPDATE completion_budget SET window_started_at = ?, attempt_count = ? WHERE singleton = 1",
      windowStartedAt,
      attemptCount + 1,
    );
    const admitted = this.ctx.storage.sql.exec<IssuedRow>(
      "SELECT pair_id FROM issued_pairs WHERE pair_id = ? AND expires_at > ? LIMIT 1",
      pairId,
      now,
    ).toArray().length > 0;
    await this.scheduleCleanup();
    return { admitted, rateLimited: false };
  }

  async release(pairId: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM issued_pairs WHERE pair_id = ?", pairId);
    await this.scheduleCleanup();
  }

  override async alarm(): Promise<void> {
    this.deleteExpired(Date.now());
    await this.scheduleCleanup();
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS issued_pairs (
        pair_id TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS issued_pairs_expiry_idx ON issued_pairs(expires_at);
      CREATE TABLE IF NOT EXISTS completion_budget (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        window_started_at INTEGER NOT NULL,
        attempt_count INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO completion_budget (singleton, window_started_at, attempt_count) VALUES (1, 0, 0);
    `);
  }

  private deleteExpired(now: number): void {
    this.ctx.storage.sql.exec("DELETE FROM issued_pairs WHERE expires_at <= ?", now);
  }

  private async scheduleCleanup(): Promise<void> {
    const next = this.ctx.storage.sql.exec<{ expires_at: number | null }>(
      "SELECT MIN(expires_at) AS expires_at FROM issued_pairs",
    ).one().expires_at;
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  private maxPendingPairs(): number {
    const value = Number.parseInt(this.env.MAX_PENDING_PAIRS, 10);
    if (!Number.isInteger(value) || value < 1 || value > 10_000) {
      throw new Error("Invalid pending-pair limit configuration");
    }
    return value;
  }

  private maxCompletionAttempts(): number {
    const value = Number.parseInt(this.env.MAX_PAIR_ATTEMPTS_PER_MINUTE, 10);
    if (!Number.isInteger(value) || value < 1 || value > 100_000) {
      throw new Error("Invalid pairing-attempt limit configuration");
    }
    return value;
  }
}

export class PairAdmissionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
