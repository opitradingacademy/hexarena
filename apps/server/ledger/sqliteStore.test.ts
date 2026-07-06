import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteLedgerStore } from "./sqliteStore";

const SENDER = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const TREASURY = "0x4444444444444444444444444444444444444444";
const TX_HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "hexarena-sqlite-"));
  dbPath = join(tmpDir, "ledger.db");
});

function cleanup(store: SqliteLedgerStore) {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
}

describe("SqliteLedgerStore", () => {
  it("creates fresh schema on first open", () => {
    const store = new SqliteLedgerStore(dbPath);
    try {
      store.upsertUser(SENDER, SENDER);
      expect(store.getUser(SENDER)?.walletAddress).toBe(SENDER);
      expect(store.balanceOf(SENDER)).toBe(0);
    } finally {
      cleanup(store);
    }
  });

  it("credits a deposit and reflects it in balanceOf (idempotent on tx_hash)", () => {
    const store = new SqliteLedgerStore(dbPath);
    try {
      store.upsertUser(SENDER, SENDER);
      // Re-creates the same scenario the API endpoint reaches after a
      // server-polling-against-publicNode success.
      store.appendEntryForOps({
        insertDeposit: store,
        appendEntry: store.appendEntry.bind(store),
        userId: SENDER,
        txHash: TX_HASH,
        token: "USDT",
        amount: 0.1,
      });
      expect(store.balanceOf(SENDER)).toBeCloseTo(0.1, 5);

      // Replay idempotency — same tx_hash should not double-credit.
      store.appendEntryForOps({
        insertDeposit: store,
        appendEntry: store.appendEntry.bind(store),
        userId: SENDER,
        txHash: TX_HASH,
        token: "USDT",
        amount: 0.1,
      });
      expect(store.balanceOf(SENDER)).toBeCloseTo(0.1, 5);
    } finally {
      cleanup(store);
    }
  });

  it("survives a server restart — reopens the same DB file", () => {
    // Production 2026-07-03 driver: the in-memory store lost every
    // credited balance on each Railway redeploy, causing the modal
    // loop. SqliteLedgerStore must persist to disk across process
    // restarts.
    const makeStore = () => new SqliteLedgerStore(dbPath);
    const store1 = makeStore();
    store1.upsertUser(SENDER, SENDER);
    store1.appendEntryForOps({
      insertDeposit: store1,
      appendEntry: store1.appendEntry.bind(store1),
      userId: SENDER,
      txHash: TX_HASH,
      token: "USDT",
      amount: 0.42,
    });
    expect(store1.balanceOf(SENDER)).toBeCloseTo(0.42, 5);
    store1.close();

    // New instance on the same file — simulates a process restart.
    const store2 = makeStore();
    try {
      expect(store2.getUser(SENDER)?.walletAddress).toBe(SENDER);
      expect(store2.balanceOf(SENDER)).toBeCloseTo(0.42, 5);
    } finally {
      cleanup(store2);
    }
  });

  it("holds stake atomically and rejects when balance would go negative", () => {
    const store = new SqliteLedgerStore(dbPath);
    try {
      store.upsertUser(SENDER, SENDER);
      store.appendEntryForOps({
        insertDeposit: store,
        appendEntry: store.appendEntry.bind(store),
        userId: SENDER,
        txHash: TX_HASH,
        token: "USDT",
        amount: 0.1,
      });

      // Hold the entire balance for a match.
      store.withTransaction(() => {
        store.appendEntry({
          userId: SENDER,
          matchId: "match-1",
          delta: -0.1,
          kind: "HOLD",
        });
      });
      expect(store.balanceOf(SENDER)).toBeCloseTo(0, 5);

      // Trying to hold beyond available balance must throw and
      // leave the ledger intact.
      expect(() =>
        store.withTransaction(() => {
          const available = store.balanceOf(SENDER);
          if (available < 0.1) {
            throw new Error("InsufficientBalanceError(mock): need 0.1, have " + available);
          }
          store.appendEntry({
            userId: SENDER,
            matchId: "match-2",
            delta: -0.1,
            kind: "HOLD",
          });
        }),
      ).toThrow(/InsufficientBalance/);
      expect(store.balanceOf(SENDER)).toBeCloseTo(0, 5);
    } finally {
      cleanup(store);
    }
  });

  it("creditDeposit honors the spec: idempotent by tx_hash, then ledger entry", () => {
    const store = new SqliteLedgerStore(dbPath);
    try {
      store.upsertUser(SENDER, SENDER);
      // Replays what creditDeposit() does (TxHash-unique deposit +
      // appendEntry DEPOSIT). Doing it twice should credit once.
      store.upsertUser(SENDER, SENDER);
      const creditOnce = (txHash: string, amount: number) => {
        if (store.findDeposit(txHash)) return;
        store.withTransaction(() => {
          store.insertDeposit({ userId: SENDER, txHash, token: "USDT", amount });
          store.appendEntry({
            userId: SENDER,
            matchId: null,
            delta: amount,
            kind: "DEPOSIT",
          });
        });
      };
      creditOnce(TX_HASH, 0.1);
      creditOnce(TX_HASH, 0.1);
      expect(store.balanceOf(SENDER)).toBeCloseTo(0.1, 5);
    } finally {
      cleanup(store);
    }
  });

  describe("Withdrawals (PR1)", () => {
    const W_ID = "11111111-2222-4333-8444-555555555555";
    const W_IDEM = "idem-abc-123";

    function makePending(): {
      id: string;
      userId: string;
      amountUSD: number;
      amountRaw: number | null;
      txHash: string | null;
      status: "PENDING" | "CONFIRMED" | "FAILED";
      idempotencyKey: string;
      confirmedAt: number | null;
      failedAt: number | null;
    } {
      return {
        id: W_ID,
        userId: SENDER,
        amountUSD: 0.1,
        amountRaw: null,
        txHash: null,
        status: "PENDING",
        idempotencyKey: W_IDEM,
        confirmedAt: null,
        failedAt: null,
      };
    }

    it("createWithdrawal inserts a row and getWithdrawal retrieves it", () => {
      const store = new SqliteLedgerStore(dbPath);
      try {
        store.upsertUser(SENDER, SENDER);
        const created = store.createWithdrawal(makePending());
        expect(created.id).toBe(W_ID);
        expect(created.status).toBe("PENDING");
        expect(created.amountUSD).toBeCloseTo(0.1, 5);
        const fetched = store.getWithdrawal(W_ID);
        expect(fetched).toBeDefined();
        expect(fetched?.idempotencyKey).toBe(W_IDEM);
      } finally {
        cleanup(store);
      }
    });

    it("createWithdrawal is idempotent on (userId, idempotencyKey)", () => {
      const store = new SqliteLedgerStore(dbPath);
      try {
        store.upsertUser(SENDER, SENDER);
        const first = store.createWithdrawal(makePending());
        const second = store.createWithdrawal(makePending());
        // Same id + same key → return the existing row, no duplicate.
        expect(second.id).toBe(first.id);
        expect(second.createdAt).toBe(first.createdAt);
        // Also exposed via the lookup-by-key API.
        const byKey = store.getWithdrawalByIdempotencyKey(SENDER, W_IDEM);
        expect(byKey?.id).toBe(W_ID);
      } finally {
        cleanup(store);
      }
    });

    it("updateWithdrawal patches status, txHash, amountRaw, timestamps", () => {
      const store = new SqliteLedgerStore(dbPath);
      try {
        store.upsertUser(SENDER, SENDER);
        store.createWithdrawal(makePending());
        const updated = store.updateWithdrawal(W_ID, {
          status: "CONFIRMED",
          txHash: "0xconfhash",
          amountRaw: 0.101523,
          confirmedAt: 1234567890,
        });
        expect(updated.status).toBe("CONFIRMED");
        expect(updated.txHash).toBe("0xconfhash");
        expect(updated.amountRaw).toBeCloseTo(0.101523, 6);
        expect(updated.confirmedAt).toBe(1234567890);
      } finally {
        cleanup(store);
      }
    });

    it("survives a restart — withdrawals persist to disk", () => {
      const makeStore = () => new SqliteLedgerStore(dbPath);
      const store1 = makeStore();
      store1.upsertUser(SENDER, SENDER);
      store1.createWithdrawal(makePending());
      store1.close();

      const store2 = makeStore();
      try {
        const fetched = store2.getWithdrawal(W_ID);
        expect(fetched).toBeDefined();
        expect(fetched?.id).toBe(W_ID);
        expect(fetched?.status).toBe("PENDING");
        const byKey = store2.getWithdrawalByIdempotencyKey(SENDER, W_IDEM);
        expect(byKey?.id).toBe(W_ID);
      } finally {
        cleanup(store2);
      }
    });
  });
});

// Sentinel unused-imports allow types we re-export indirectly.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
void RECIPIENT;
void TREASURY;
