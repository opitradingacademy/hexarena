import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type {
  Deposit,
  LedgerEntry,
  LedgerEntryKind,
  LedgerStore,
  Match,
  MatchId,
  User,
  UserId,
  Withdrawal,
} from "./types";

/**
 * On-disk `LedgerStore` backed by SQLite via better-sqlite3. Drop-in
 * replacement for `MemoryLedgerStore` — survives process restarts and
 * Railway redeploys, the bug that drove all the 2026-07-03 modal-loop
 * debugging (each redeploy wiped the in-memory ledger, so any deposit
 * the user had signed minutes earlier stopped counting toward their
 * join_queue balance).
 *
 * Storage: a single .db file passed at construction. Production
 * Railway mounts a persistent volume at /data, so SQLITE_PATH defaults
 * to /data/hexarena.db. The schema is created idempotently on first
 * open so the migration story is "just point at a path".
 *
 * Concurrency: better-sqlite3 serializes write transactions internally,
 * so `withTransaction(() => { ... })` is safe even when many socket
 * events stream in concurrently. SQLITE_BUSY retries are handled by
 * the underlying driver.
 */
export class SqliteLedgerStore implements LedgerStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  /** Apply the schema if no tables exist. Idempotent — safe on every open. */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        walletAddress TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );

      -- One row per on-chain deposit (audit trail / idempotency key).
      CREATE TABLE IF NOT EXISTS deposits (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        txHash TEXT NOT NULL UNIQUE,
        token TEXT NOT NULL,
        amount REAL NOT NULL,
        creditedAt INTEGER NOT NULL
      );

      -- Append-only ledger of balance changes per match / event.
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        matchId TEXT,
        delta REAL NOT NULL,
        kind TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_entries_user
        ON ledger_entries (userId, createdAt);

      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        p1 TEXT NOT NULL,
        p2 TEXT NOT NULL,
        stake REAL NOT NULL,
        winner TEXT,
        state TEXT NOT NULL,
        settleTx TEXT,
        createdAt INTEGER NOT NULL,
        endedAt INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_matches_users
        ON matches (p1, createdAt);
      CREATE INDEX IF NOT EXISTS idx_matches_p2
        ON matches (p2, createdAt);

      -- Cash-out requests (PR1). One row per (userId, idempotencyKey).
      -- amountUSD is the user-facing debit; amountRaw is the gross
      -- amount signed to the contract (operator absorbs the ~1.5% USDT
      -- transfer fee). Status moves PENDING -> CONFIRMED | FAILED.
      CREATE TABLE IF NOT EXISTS withdrawals (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        amountUSD REAL NOT NULL,
        amountRaw REAL,
        txHash TEXT,
        status TEXT NOT NULL,
        idempotencyKey TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        confirmedAt INTEGER,
        failedAt INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_idem
        ON withdrawals (userId, idempotencyKey);
      CREATE INDEX IF NOT EXISTS idx_withdrawals_user
        ON withdrawals (userId, createdAt);
    `);
  }

  /** Closed at process end; tests should also call this so the file is flushed. */
  close(): void {
    this.db.close();
  }

  // ---- User ----

  getUser(id: UserId): User | undefined {
    const row = this.db
      .prepare("SELECT id, walletAddress, createdAt FROM users WHERE id = ?")
      .get(id) as { id: string; walletAddress: string; createdAt: number } | undefined;
    return row
      ? { id: row.id, walletAddress: row.walletAddress, createdAt: row.createdAt }
      : undefined;
  }

  upsertUser(id: UserId, walletAddress: string): User {
    const existing = this.getUser(id);
    if (existing) return existing;
    const user: User = { id, walletAddress, createdAt: Date.now() };
    this.db
      .prepare(
        "INSERT INTO users (id, walletAddress, createdAt) VALUES (?, ?, ?)" +
          " ON CONFLICT(id) DO NOTHING",
      )
      .run(user.id, user.walletAddress, user.createdAt);
    return user;
  }

  // ---- Deposits ----

  findDeposit(txHash: string): Deposit | undefined {
    const row = this.db
      .prepare(
        "SELECT id, userId, txHash, token, amount, creditedAt FROM deposits WHERE txHash = ?",
      )
      .get(txHash) as Deposit | undefined;
    return row;
  }

  insertDeposit(d: Omit<Deposit, "id" | "creditedAt">): Deposit {
    const deposit: Deposit = { ...d, id: randomUUID(), creditedAt: Date.now() };
    this.db
      .prepare(
        "INSERT INTO deposits (id, userId, txHash, token, amount, creditedAt)" +
          " VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        deposit.id,
        deposit.userId,
        deposit.txHash,
        deposit.token,
        deposit.amount,
        deposit.creditedAt,
      );
    return deposit;
  }

  // ---- Ledger entries ----

  /**
   * `SUM(delta)` over all entries for a user. Because entries are
   * append-only, the running balance is a single full-table scan; cheap
   * for the MVP scale (<10k entries). For PR6 we can add an indexed
   * per-user balance cache if it becomes the hotspot.
   */
  balanceOf(userId: UserId): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(delta), 0) AS total FROM ledger_entries WHERE userId = ?")
      .get(userId) as { total: number };
    return row.total;
  }

  appendEntry(e: Omit<LedgerEntry, "id" | "createdAt">): LedgerEntry {
    const entry: LedgerEntry = { ...e, id: randomUUID(), createdAt: Date.now() };
    this.db
      .prepare(
        "INSERT INTO ledger_entries (id, userId, matchId, delta, kind, createdAt)" +
          " VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(entry.id, entry.userId, entry.matchId, entry.delta, entry.kind, entry.createdAt);
    return entry;
  }

  entriesForMatch(matchId: MatchId): LedgerEntry[] {
    return this.db
      .prepare(
        "SELECT id, userId, matchId, delta, kind, createdAt FROM ledger_entries" +
          " WHERE matchId = ? ORDER BY createdAt ASC",
      )
      .all(matchId) as LedgerEntry[];
  }

  // ---- Matches ----

  getMatch(id: MatchId): Match | undefined {
    return this.db
      .prepare(
        "SELECT id, mode, p1, p2, stake, winner, state, settleTx, createdAt, endedAt" +
          " FROM matches WHERE id = ?",
      )
      .get(id) as Match | undefined;
  }

  insertMatch(
    m: Omit<Match, "createdAt" | "endedAt" | "settleTx"> & { settleTx?: string | null },
  ): Match {
    const match: Match = {
      ...m,
      settleTx: m.settleTx ?? null,
      createdAt: Date.now(),
      endedAt: null,
    };
    this.db
      .prepare(
        "INSERT INTO matches (id, mode, p1, p2, stake, winner, state, settleTx, createdAt, endedAt)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        match.id,
        match.mode,
        match.p1,
        match.p2,
        match.stake,
        match.winner,
        match.state,
        match.settleTx,
        match.createdAt,
        match.endedAt,
      );
    return match;
  }

  updateMatch(id: MatchId, patch: Partial<Match>): Match {
    const existing = this.getMatch(id);
    if (!existing) throw new Error(`match not found: ${id}`);
    const updated: Match = { ...existing, ...patch };
    this.db
      .prepare(
        "UPDATE matches SET mode = ?, p1 = ?, p2 = ?, stake = ?, winner = ?," +
          " state = ?, settleTx = ?, endedAt = ? WHERE id = ?",
      )
      .run(
        updated.mode,
        updated.p1,
        updated.p2,
        updated.stake,
        updated.winner,
        updated.state,
        updated.settleTx,
        updated.endedAt,
        id,
      );
    return updated;
  }

  matchHistoryFor(userId: UserId): Match[] {
    return this.db
      .prepare(
        "SELECT id, mode, p1, p2, stake, winner, state, settleTx, createdAt, endedAt" +
          " FROM matches WHERE p1 = ? OR p2 = ? ORDER BY createdAt DESC",
      )
      .all(userId, userId) as Match[];
  }

  // ---- Cash-out (PR1) ----

  /**
   * Insert a withdrawal row. Idempotent on (userId, idempotencyKey) —
   * if a row already exists for that pair, returns the existing one
   * unchanged (lets clients safely retry the same cash-out). The
   * unique index on (userId, idempotencyKey) backs this; on collision
   * we look up and return instead of throwing.
   */
  createWithdrawal(w: Omit<Withdrawal, "createdAt">): Withdrawal {
    const existing = this.getWithdrawalByIdempotencyKey(w.userId, w.idempotencyKey);
    if (existing) return existing;
    const withdrawal: Withdrawal = { ...w, createdAt: Date.now() };
    try {
      this.db
        .prepare(
          "INSERT INTO withdrawals (id, userId, amountUSD, amountRaw, txHash, status," +
            " idempotencyKey, createdAt, confirmedAt, failedAt)" +
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          withdrawal.id,
          withdrawal.userId,
          withdrawal.amountUSD,
          withdrawal.amountRaw,
          withdrawal.txHash,
          withdrawal.status,
          withdrawal.idempotencyKey,
          withdrawal.createdAt,
          withdrawal.confirmedAt,
          withdrawal.failedAt,
        );
    } catch (e) {
      // The unique index makes this race-safe: two concurrent
      // cash-outs with the same (userId, idempotencyKey) — second
      // insert collides, fall back to the existing row.
      const msg = (e as Error).message;
      if (msg.includes("UNIQUE") || msg.includes("constraint")) {
        const row = this.getWithdrawalByIdempotencyKey(w.userId, w.idempotencyKey);
        if (row) return row;
      }
      throw e;
    }
    return withdrawal;
  }

  getWithdrawal(id: string): Withdrawal | undefined {
    return this.db
      .prepare(
        "SELECT id, userId, amountUSD, amountRaw, txHash, status, idempotencyKey," +
          " createdAt, confirmedAt, failedAt FROM withdrawals WHERE id = ?",
      )
      .get(id) as Withdrawal | undefined;
  }

  getWithdrawalByIdempotencyKey(userId: UserId, key: string): Withdrawal | undefined {
    return this.db
      .prepare(
        "SELECT id, userId, amountUSD, amountRaw, txHash, status, idempotencyKey," +
          " createdAt, confirmedAt, failedAt FROM withdrawals" +
          " WHERE userId = ? AND idempotencyKey = ?",
      )
      .get(userId, key) as Withdrawal | undefined;
  }

  updateWithdrawal(id: string, patch: Partial<Withdrawal>): Withdrawal {
    const existing = this.getWithdrawal(id);
    if (!existing) throw new Error(`withdrawal not found: ${id}`);
    const updated: Withdrawal = { ...existing, ...patch };
    this.db
      .prepare(
        "UPDATE withdrawals SET amountUSD = ?, amountRaw = ?, txHash = ?," +
          " status = ?, confirmedAt = ?, failedAt = ? WHERE id = ?",
      )
      .run(
        updated.amountUSD,
        updated.amountRaw,
        updated.txHash,
        updated.status,
        updated.confirmedAt,
        updated.failedAt,
        id,
      );
    return updated;
  }

  /**
   * Run `fn` as a single SQL transaction. better-sqlite3 is
   * synchronous so there's no `BEGIN`/`COMMIT` race; if `fn` throws
   * we ROLLBACK and re-throw.
   */
  withTransaction<T>(fn: () => T): T {
    const tx = this.db.transaction(fn);
    return tx();
  }

  /**
   * Test-only seam — runs the credit-deposit flow with explicit
   * shapes so the test can mirror what `ledger.ts creditDeposit` does
   * without depending on the full module wiring.
   */
  appendEntryForOps(args: {
    insertDeposit: Pick<SqliteLedgerStore, "insertDeposit">;
    appendEntry: (e: Omit<LedgerEntry, "id" | "createdAt">) => LedgerEntry;
    userId: UserId;
    txHash: string;
    token: string;
    amount: number;
  }): void {
    if (this.findDeposit(args.txHash)) return;
    this.withTransaction(() => {
      args.insertDeposit.insertDeposit({
        userId: args.userId,
        txHash: args.txHash,
        token: args.token,
        amount: args.amount,
      });
      args.appendEntry({
        userId: args.userId,
        matchId: null,
        delta: args.amount,
        kind: "DEPOSIT" satisfies LedgerEntryKind,
      });
    });
  }
}
