import { randomUUID } from "node:crypto";
import type {
  Deposit,
  LedgerEntry,
  LedgerStore,
  Match,
  MatchId,
  User,
  UserId,
} from "./types";

/**
 * In-memory `LedgerStore`. See types.ts for the storage rationale.
 * Safe for single-process MVP use: Node is single-threaded, so
 * withTransaction's snapshot/restore gives the same "no partial writes"
 * guarantee a real DB transaction would.
 */
export class MemoryLedgerStore implements LedgerStore {
  private users = new Map<UserId, User>();
  private deposits: Deposit[] = [];
  private entries: LedgerEntry[] = [];
  private matches = new Map<MatchId, Match>();

  getUser(id: UserId): User | undefined {
    return this.users.get(id);
  }

  upsertUser(id: UserId, walletAddress: string): User {
    const existing = this.users.get(id);
    if (existing) return existing;
    const user: User = { id, walletAddress, createdAt: Date.now() };
    this.users.set(id, user);
    return user;
  }

  findDeposit(txHash: string): Deposit | undefined {
    return this.deposits.find((d) => d.txHash === txHash);
  }

  insertDeposit(d: Omit<Deposit, "id" | "creditedAt">): Deposit {
    if (this.findDeposit(d.txHash)) {
      throw new Error(`duplicate tx_hash: ${d.txHash}`);
    }
    const deposit: Deposit = { ...d, id: randomUUID(), creditedAt: Date.now() };
    this.deposits.push(deposit);
    return deposit;
  }

  balanceOf(userId: UserId): number {
    return this.entries
      .filter((e) => e.userId === userId)
      .reduce((sum, e) => sum + e.delta, 0);
  }

  appendEntry(e: Omit<LedgerEntry, "id" | "createdAt">): LedgerEntry {
    const entry: LedgerEntry = { ...e, id: randomUUID(), createdAt: Date.now() };
    this.entries.push(entry);
    return entry;
  }

  entriesForMatch(matchId: MatchId): LedgerEntry[] {
    return this.entries.filter((e) => e.matchId === matchId);
  }

  getMatch(id: MatchId): Match | undefined {
    return this.matches.get(id);
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
    this.matches.set(match.id, match);
    return match;
  }

  updateMatch(id: MatchId, patch: Partial<Match>): Match {
    const existing = this.matches.get(id);
    if (!existing) throw new Error(`match not found: ${id}`);
    const updated = { ...existing, ...patch };
    this.matches.set(id, updated);
    return updated;
  }

  matchHistoryFor(userId: UserId): Match[] {
    return [...this.matches.values()]
      .filter((m) => m.p1 === userId || m.p2 === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  withTransaction<T>(fn: () => T): T {
    const entriesSnapshot = [...this.entries];
    const matchesSnapshot = new Map(this.matches);
    try {
      return fn();
    } catch (err) {
      this.entries = entriesSnapshot;
      this.matches = matchesSnapshot;
      throw err;
    }
  }
}
