/**
 * Ledger business logic — invariants per arena-settlement spec.
 * Pure application logic over a `LedgerStore`; no Socket.IO, no chain calls.
 */
import type { LedgerStore, MatchId, UserId } from "./types";
import { InsufficientBalanceError } from "./errors";

/** House rake: 20% of total pool, per "House Rake on Payout" / "Draw Refund Minus House Rake". */
export const HOUSE_RAKE = 0.2;

export function balanceOf(store: LedgerStore, userId: UserId): number {
  return store.balanceOf(userId);
}

/** Idempotent by tx_hash — spec "Unique Deposit Crediting". */
export function creditDeposit(
  store: LedgerStore,
  userId: UserId,
  txHash: string,
  amount: number,
  token = "USDm",
): void {
  if (store.findDeposit(txHash)) {
    return; // already credited — no-op, no second entry
  }
  store.withTransaction(() => {
    store.insertDeposit({ userId, txHash, token, amount });
    store.appendEntry({ userId, matchId: null, delta: amount, kind: "DEPOSIT" });
  });
}

/**
 * HOLD stake for a match — atomic, rejects if it would drive balance negative.
 * Spec "Non-Negative Balance" / "Atomic Hold/Release".
 */
export function holdStake(
  store: LedgerStore,
  userId: UserId,
  matchId: MatchId,
  amount: number,
): void {
  store.withTransaction(() => {
    const available = store.balanceOf(userId);
    if (available < amount) {
      throw new InsufficientBalanceError(userId, amount, available);
    }
    store.appendEntry({ userId, matchId, delta: -amount, kind: "HOLD" });
  });
}

export type SettleResult = { payout: number; rake: number };

/**
 * Decisive win: winner receives (p1Stake+p2Stake) * (1 - HOUSE_RAKE); loser's
 * HOLD is not released (rake + loss absorbed). Atomic per match.
 * Spec "House Rake on Payout".
 */
export function settleDecisive(
  store: LedgerStore,
  matchId: MatchId,
  winnerId: UserId,
  loserId: UserId,
  winnerStake: number,
  loserStake: number,
): SettleResult {
  const pool = winnerStake + loserStake;
  const payout = pool * (1 - HOUSE_RAKE);
  const rake = pool * HOUSE_RAKE;

  store.withTransaction(() => {
    store.appendEntry({ userId: winnerId, matchId, delta: payout, kind: "PAYOUT" });
    // loser's HOLD stands (already debited at hold time) — no further entry needed.
    void loserId;
  });

  return { payout, rake };
}

export type DrawResult = { refundEach: number };

/**
 * Draw: each player refunded stake*(1-HOUSE_RAKE); house still keeps its cut.
 * No on-chain settle() call required for draws — spec "Draw Refund Minus House Rake".
 */
export function settleDraw(
  store: LedgerStore,
  matchId: MatchId,
  p1: UserId,
  p2: UserId,
  p1Stake: number,
  p2Stake: number,
): DrawResult {
  const refund1 = p1Stake * (1 - HOUSE_RAKE);
  const refund2 = p2Stake * (1 - HOUSE_RAKE);

  store.withTransaction(() => {
    store.appendEntry({ userId: p1, matchId, delta: refund1, kind: "REFUND" });
    store.appendEntry({ userId: p2, matchId, delta: refund2, kind: "REFUND" });
  });

  return { refundEach: refund1 };
}

/**
 * VOID: full refund, no rake, no on-chain settle() call.
 * Spec "Full Refund on Server-Error Void".
 */
export function voidMatch(
  store: LedgerStore,
  matchId: MatchId,
  players: { userId: UserId; stake: number }[],
): void {
  store.withTransaction(() => {
    for (const p of players) {
      store.appendEntry({ userId: p.userId, matchId, delta: p.stake, kind: "REFUND" });
    }
    if (store.getMatch(matchId)) {
      store.updateMatch(matchId, { state: "VOID", endedAt: Date.now() });
    }
  });
}
