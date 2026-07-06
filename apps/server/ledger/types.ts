/**
 * Ledger data model — mirrors design.md "Ledger Schema (Postgres)".
 *
 * Storage choice (MVP): in-memory `LedgerStore` implementation
 * (see memoryStore.ts) behind this interface. Rationale: the game/ledger
 * logic must be unit-testable with zero external infra (Strict TDD, no
 * DB server available in CI), and the interface is small enough that a
 * Postgres-backed implementation can be dropped in later (PR5/production)
 * without touching ledger.ts or the Socket.IO handlers. better-sqlite3
 * was considered but rejected for MVP: it requires a native build step
 * that complicates CI, and the append-only ledger_entries model needs no
 * SQL features beyond what an in-memory array + index gives us today.
 */

export type UserId = string;
export type MatchId = string;

export type User = {
  id: UserId;
  walletAddress: string;
  createdAt: number;
};

export type Deposit = {
  id: string;
  userId: UserId;
  txHash: string;
  token: string;
  amount: number;
  creditedAt: number;
};

export type LedgerEntryKind =
  "DEPOSIT" | "HOLD" | "RELEASE" | "PAYOUT" | "REFUND" | "WITHDRAW" | "WITHDRAW_REVERSAL";

/**
 * Cash-out request record. `id` is a uuid v4 (also the `withdrawalId`
 * sent to the contract, hashed to bytes32 by the chain adapter). The
 * flow is: create PENDING (with ledger debited) → CONFIRMED (with txHash)
 * → or FAILED (with WITHDRAW_REVERSAL ledger entry restoring balance).
 */
export type Withdrawal = {
  id: string;
  userId: UserId;
  /** User-facing debit amount (the number the user typed in "Cash out $X"). */
  amountUSD: number;
  /**
   * Gross amount sent to the on-chain contract (USDT raw, but tracked
   * here as a number for audit logs). Operator absorbs the ~1.5% USDT
   * transfer fee, so this is `amountUSD / 0.985`. Null when the tx
   * never broadcast (e.g. PENDING that was never confirmed).
   */
  amountRaw: number | null;
  txHash: string | null;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  /** Client-supplied uuid v4 — second-level idempotency key. */
  idempotencyKey: string;
  createdAt: number;
  confirmedAt: number | null;
  failedAt: number | null;
};

export type LedgerEntry = {
  id: string;
  userId: UserId;
  matchId: MatchId | null;
  delta: number;
  kind: LedgerEntryKind;
  createdAt: number;
};

export type MatchMode = "CASUAL" | "ARENA";
export type MatchState = "QUEUED" | "ACTIVE" | "FINISHED" | "SETTLED" | "VOID";

export type Match = {
  id: MatchId;
  mode: MatchMode;
  p1: UserId;
  p2: UserId;
  stake: number;
  winner: UserId | null;
  state: MatchState;
  settleTx: string | null;
  createdAt: number;
  endedAt: number | null;
};

export interface LedgerStore {
  getUser(id: UserId): User | undefined;
  upsertUser(id: UserId, walletAddress: string): User;

  findDeposit(txHash: string): Deposit | undefined;
  insertDeposit(d: Omit<Deposit, "id" | "creditedAt">): Deposit;

  balanceOf(userId: UserId): number;
  appendEntry(e: Omit<LedgerEntry, "id" | "createdAt">): LedgerEntry;
  entriesForMatch(matchId: MatchId): LedgerEntry[];

  getMatch(id: MatchId): Match | undefined;
  insertMatch(
    m: Omit<Match, "createdAt" | "endedAt" | "settleTx"> & { settleTx?: string | null },
  ): Match;
  updateMatch(id: MatchId, patch: Partial<Match>): Match;
  /** Reverse-chronological match history for a user — History screen (design.md Wireframe #4). */
  matchHistoryFor(userId: UserId): Match[];

  // ---- Cash-out (PR1) ----

  /** Create a new PENDING withdrawal row. Idempotent on (userId, idempotencyKey). */
  createWithdrawal(w: Omit<Withdrawal, "createdAt">): Withdrawal;
  /** Look up a withdrawal by its uuid v4 id. */
  getWithdrawal(id: string): Withdrawal | undefined;
  /** Look up a withdrawal by the client-supplied idempotency key (per user). */
  getWithdrawalByIdempotencyKey(userId: UserId, key: string): Withdrawal | undefined;
  /** Patch a withdrawal (status / txHash / amountRaw / timestamps). */
  updateWithdrawal(id: string, patch: Partial<Withdrawal>): Withdrawal;

  /**
   * Runs `fn` as a single atomic unit. In-memory: snapshots ledger_entries
   * and matches, runs fn, restores the snapshot if fn throws — no partial
   * writes are observable. A real DB adapter would wrap this in
   * BEGIN/COMMIT/ROLLBACK.
   */
  withTransaction<T>(fn: () => T): T;
}
