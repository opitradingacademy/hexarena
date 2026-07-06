import { describe, expect, it, beforeEach } from "vitest";
import { MemoryLedgerStore } from "./memoryStore";
import {
  creditDeposit,
  holdStake,
  balanceOf,
  settleDecisive,
  settleDraw,
  voidMatch,
  HOUSE_RAKE,
  cashoutInitiate,
  cashoutConfirm,
  cashoutFail,
  MIN_CASHOUT_USD,
  CASHOUT_FEE_DIVISOR,
} from "./ledger";
import { InsufficientBalanceError } from "./errors";

describe("ledger", () => {
  let store: MemoryLedgerStore;

  beforeEach(() => {
    store = new MemoryLedgerStore();
    store.upsertUser("u1", "0xaaa");
    store.upsertUser("u2", "0xbbb");
  });

  describe("Non-Negative Balance (arena-settlement)", () => {
    it("rejects hold when balance insufficient and writes no entry", () => {
      creditDeposit(store, "u1", "0xtx1", 0.05);
      expect(() => holdStake(store, "u1", "m1", 0.1)).toThrow(InsufficientBalanceError);
      expect(balanceOf(store, "u1")).toBe(0.05);
      expect(store.entriesForMatch("m1")).toHaveLength(0);
    });

    it("holds succeed within balance and result stays >= 0", () => {
      creditDeposit(store, "u1", "0xtx2", 1.0);
      holdStake(store, "u1", "m1", 0.5);
      expect(balanceOf(store, "u1")).toBe(0.5);
    });
  });

  describe("Unique Deposit Crediting", () => {
    it("does not double-credit a duplicate tx_hash", () => {
      creditDeposit(store, "u1", "0xdup", 1.0);
      expect(() => creditDeposit(store, "u1", "0xdup", 1.0)).not.toThrow();
      expect(balanceOf(store, "u1")).toBe(1.0);
    });
  });

  describe("Atomic Hold/Release + House Rake on Payout", () => {
    it("standard win payout: pool*0.8 to winner, 0.2 rake retained", () => {
      creditDeposit(store, "u1", "0xa", 0.1);
      creditDeposit(store, "u2", "0xb", 0.1);
      holdStake(store, "u1", "m1", 0.1);
      holdStake(store, "u2", "m1", 0.1);

      const result = settleDecisive(store, "m1", "u1", "u2", 0.1, 0.1);

      expect(result.payout).toBeCloseTo(0.16, 6);
      expect(result.rake).toBeCloseTo(0.04, 6);
      expect(balanceOf(store, "u1")).toBeCloseTo(0.16, 6);
      expect(balanceOf(store, "u2")).toBeCloseTo(0, 6);
      expect(HOUSE_RAKE).toBe(0.2);
    });
  });

  describe("Draw Refund Minus House Rake", () => {
    it("refunds each player stake*0.8 on draw", () => {
      creditDeposit(store, "u1", "0xa2", 0.1);
      creditDeposit(store, "u2", "0xb2", 0.1);
      holdStake(store, "u1", "m2", 0.1);
      holdStake(store, "u2", "m2", 0.1);

      const result = settleDraw(store, "m2", "u1", "u2", 0.1, 0.1);

      expect(result.refundEach).toBeCloseTo(0.08, 6);
      expect(balanceOf(store, "u1")).toBeCloseTo(0.08, 6);
      expect(balanceOf(store, "u2")).toBeCloseTo(0.08, 6);
    });
  });

  describe("Full Refund on Server-Error Void", () => {
    it("refunds full original stake with no rake", () => {
      creditDeposit(store, "u1", "0xa3", 0.1);
      creditDeposit(store, "u2", "0xb3", 0.1);
      holdStake(store, "u1", "m3", 0.1);
      holdStake(store, "u2", "m3", 0.1);

      voidMatch(store, "m3", [
        { userId: "u1", stake: 0.1 },
        { userId: "u2", stake: 0.1 },
      ]);

      expect(balanceOf(store, "u1")).toBeCloseTo(0.1, 6);
      expect(balanceOf(store, "u2")).toBeCloseTo(0.1, 6);
    });
  });

  describe("Cash-out (PR1)", () => {
    const WITHDRAWAL_ID = "11111111-2222-4333-8444-555555555555";
    const IDEMPOTENCY_KEY = "idem-abc-123";

    it("exports the minimum cashout and fee-absorption constants", () => {
      expect(MIN_CASHOUT_USD).toBe(0.1);
      expect(CASHOUT_FEE_DIVISOR).toBe(0.985);
    });

    it("cashoutInitiate debits the ledger and creates a PENDING withdrawal", () => {
      creditDeposit(store, "u1", "0xw-dep-1", 1.0);
      const w = cashoutInitiate(store, "u1", WITHDRAWAL_ID, 0.5, IDEMPOTENCY_KEY);
      expect(w.id).toBe(WITHDRAWAL_ID);
      expect(w.status).toBe("PENDING");
      expect(w.amountUSD).toBe(0.5);
      expect(w.amountRaw).toBeNull();
      expect(w.txHash).toBeNull();
      expect(balanceOf(store, "u1")).toBeCloseTo(0.5, 6);
    });

    it("cashoutInitiate rejects when balance would go negative", () => {
      creditDeposit(store, "u1", "0xw-dep-2", 0.05);
      expect(() => cashoutInitiate(store, "u1", WITHDRAWAL_ID, 0.5, IDEMPOTENCY_KEY)).toThrow(
        InsufficientBalanceError,
      );
      // The aborted transaction must leave balance intact (no partial writes).
      expect(balanceOf(store, "u1")).toBeCloseTo(0.05, 6);
      expect(store.getWithdrawal(WITHDRAWAL_ID)).toBeUndefined();
    });

    it("cashoutConfirm records the txHash + amountRaw without changing the balance", () => {
      creditDeposit(store, "u1", "0xw-dep-3", 1.0);
      cashoutInitiate(store, "u1", WITHDRAWAL_ID, 0.5, IDEMPOTENCY_KEY);
      const balanceBefore = balanceOf(store, "u1");

      const confirmed = cashoutConfirm(store, WITHDRAWAL_ID, "0xabc123", 0.5076);

      expect(confirmed.status).toBe("CONFIRMED");
      expect(confirmed.txHash).toBe("0xabc123");
      expect(confirmed.amountRaw).toBeCloseTo(0.5076, 6);
      expect(confirmed.confirmedAt).not.toBeNull();
      expect(balanceOf(store, "u1")).toBeCloseTo(balanceBefore, 6);
    });

    it("cashoutFail writes a WITHDRAW_REVERSAL entry and restores the balance", () => {
      creditDeposit(store, "u1", "0xw-dep-4", 1.0);
      cashoutInitiate(store, "u1", WITHDRAWAL_ID, 0.5, IDEMPOTENCY_KEY);
      expect(balanceOf(store, "u1")).toBeCloseTo(0.5, 6);

      const failed = cashoutFail(store, WITHDRAWAL_ID);

      expect(failed.status).toBe("FAILED");
      expect(failed.failedAt).not.toBeNull();
      // Balance is restored — debit + reversal = 0 net change.
      expect(balanceOf(store, "u1")).toBeCloseTo(1.0, 6);
    });

    it("idempotency: same withdrawalId returns the same row, no second debit", () => {
      creditDeposit(store, "u1", "0xw-dep-5", 1.0);
      const first = cashoutInitiate(store, "u1", WITHDRAWAL_ID, 0.4, IDEMPOTENCY_KEY);
      const second = cashoutInitiate(store, "u1", WITHDRAWAL_ID, 0.4, IDEMPOTENCY_KEY);
      expect(second.id).toBe(first.id);
      expect(balanceOf(store, "u1")).toBeCloseTo(0.6, 6);
    });

    it("same idempotency key with a DIFFERENT amount is rejected (409 semantics live in the handler)", () => {
      // Ledger itself is idempotent on (userId, idempotencyKey) — the
      // handler layer is responsible for detecting the conflict by
      // comparing the requested amount to the existing row's
      // amountUSD. The ledger does NOT silently accept a different
      // amount under the same key.
      creditDeposit(store, "u1", "0xw-dep-6", 1.0);
      cashoutInitiate(store, "u1", WITHDRAWAL_ID, 0.4, IDEMPOTENCY_KEY);
      const second = cashoutInitiate(store, "u1", WITHDRAWAL_ID, 0.6, IDEMPOTENCY_KEY);
      // Idempotent on id+key: returns the FIRST row, NOT the second.
      expect(second.amountUSD).toBe(0.4);
    });
  });
});
