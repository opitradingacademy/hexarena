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
});
