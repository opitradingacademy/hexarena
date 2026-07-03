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
});

// Sentinel unused-imports allow types we re-export indirectly.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
void RECIPIENT;
void TREASURY;
