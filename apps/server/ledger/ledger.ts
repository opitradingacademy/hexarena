/**
 * Ledger business logic — invariants per arena-settlement spec.
 * Pure application logic over a `LedgerStore`; no Socket.IO, no chain calls.
 */
import type { LedgerStore, MatchId, UserId, Withdrawal } from "./types";
import { InsufficientBalanceError } from "./errors";

/** House rake: 20% of total pool, per "House Rake on Payout" / "Draw Refund Minus House Rake". */
export const HOUSE_RAKE = 0.2;

/** Minimum allowed cash-out. Below this the handler rejects with BELOW_MINIMUM. */
export const MIN_CASHOUT_USD = 0.1;

/**
 * USDT on Celo Mainnet charges ~1.5% on each transfer (community fund
 * fee embedded in the token). The contract is called with the GROSS
 * amount so the user nets close to amountUSD; the operator absorbs
 * the delta. See apps/server/chain/withdraw.ts and the cash-out
 * change design for the rationale.
 */
export const CASHOUT_FEE_DIVISOR = 0.985;

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

// ---------------------------------------------------------------------------
// Cash-out (PR1 of the cash-out change)
//
// Atomic order: debit FIRST, broadcast on-chain SECOND, confirm LAST.
// If the tx reverts, the caller writes a WITHDRAW_REVERSAL entry via
// cashoutFail() — never a partial write. The withdrawUser() contract
// call is idempotent on `withdrawalId` (hashed to bytes32) so a
// duplicate broadcast is safe.
// ---------------------------------------------------------------------------

/**
 * Initiates a cashout. Debits the user's ledger by `amountUSD` (the
 * user-facing number — NOT `amountRaw`, which is the gross signed
 * amount on-chain). The balance invariant (never negative) is
 * preserved by the inner check.
 *
 * Idempotent on the supplied `withdrawalId`: replaying the same call
 * returns the existing row, no second debit.
 */
export function cashoutInitiate(
  store: LedgerStore,
  userId: UserId,
  withdrawalId: string,
  amountUSD: number,
  idempotencyKey: string,
): Withdrawal {
  return store.withTransaction(() => {
    const existing = store.getWithdrawal(withdrawalId);
    if (existing) return existing;

    const available = store.balanceOf(userId);
    if (available < amountUSD) {
      throw new InsufficientBalanceError(userId, amountUSD, available);
    }

    store.appendEntry({ userId, matchId: null, delta: -amountUSD, kind: "WITHDRAW" });
    return store.createWithdrawal({
      id: withdrawalId,
      userId,
      amountUSD,
      amountRaw: null,
      txHash: null,
      status: "PENDING",
      idempotencyKey,
      confirmedAt: null,
      failedAt: null,
    });
  });
}

/**
 * Marks a previously-initiated withdrawal CONFIRMED. Does NOT touch
 * the balance — the debit landed at initiate time and the on-chain
 * delivery is the user's own. Records the gross `amountRaw` sent to
 * the contract (operator absorbed the ~1.5% delta) for audit.
 */
export function cashoutConfirm(
  store: LedgerStore,
  withdrawalId: string,
  txHash: string,
  amountRaw: number,
): Withdrawal {
  return store.updateWithdrawal(withdrawalId, {
    status: "CONFIRMED",
    txHash,
    amountRaw,
    confirmedAt: Date.now(),
  });
}

/**
 * Reverses a failed PENDING withdrawal. Writes a WITHDRAW_REVERSAL
 * ledger entry with delta = +amountUSD to restore the user's
 * balance. Use this when the on-chain broadcast reverted (rejected
 * by the contract, RPC error, etc.).
 */
export function cashoutFail(store: LedgerStore, withdrawalId: string): Withdrawal {
  const w = store.getWithdrawal(withdrawalId);
  if (!w) {
    throw new Error(`cashoutFail: unknown withdrawal ${withdrawalId}`);
  }
  store.withTransaction(() => {
    store.appendEntry({
      userId: w.userId,
      matchId: null,
      delta: w.amountUSD,
      kind: "WITHDRAW_REVERSAL",
    });
    store.updateWithdrawal(withdrawalId, {
      status: "FAILED",
      failedAt: Date.now(),
    });
  });
  // Re-read so the caller sees the patched row.
  return store.getWithdrawal(withdrawalId)!;
}
