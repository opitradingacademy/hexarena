import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MatchSession } from "./matchSession";
import { MemoryLedgerStore } from "./ledger/memoryStore";
import { creditDeposit, balanceOf } from "./ledger/ledger";
import { DISCONNECT_GRACE_MS } from "@hexarena/shared/protocol";

function makeSession(mode: "CASUAL" | "ARENA", stake = 0.1) {
  const store = new MemoryLedgerStore();
  store.upsertUser("p1", "0x1");
  store.upsertUser("p2", "0x2");
  if (mode === "ARENA") {
    creditDeposit(store, "p1", "0xtxp1", stake);
    creditDeposit(store, "p2", "0xtxp2", stake);
  }
  const events: { userId: string; event: string; payload: unknown }[] = [];
  const session = new MatchSession({
    matchId: "m1",
    mode,
    stake,
    players: { P1: "p1", P2: "p2" },
    store,
    emit: (userId, event, payload) => events.push({ userId: userId as string, event, payload }),
  });
  return { session, store, events };
}

describe("MatchSession — Game Over Delivery", () => {
  it("casual game_over has no arena field", () => {
    const { session, events } = makeSession("CASUAL");
    session.resign("p1");
    const gameOver = events.find((e) => e.event === "game_over")!;
    expect(gameOver.payload).toEqual({ winner: "P2", reason: "resign" });
  });

  it("arena game_over includes prizeUSD + settleTxPending:true, ledger paid 80%", () => {
    const { session, events, store } = makeSession("ARENA", 0.1);
    session.resign("p1");
    const gameOver = events.find((e) => e.event === "game_over")! as {
      payload: { winner: string; reason: string; arena: { prizeUSD: number; settleTxPending: boolean } };
    };
    expect(gameOver.payload.winner).toBe("P2");
    expect(gameOver.payload.reason).toBe("resign");
    expect(gameOver.payload.arena.prizeUSD).toBeCloseTo(0.16, 6);
    expect(gameOver.payload.arena.settleTxPending).toBe(true);
    expect(balanceOf(store, "p2")).toBeCloseTo(0.16, 6);
  });
});

describe("MatchSession — Disconnection Grace Window", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reconnect within grace window resumes without forfeiting", () => {
    const { session, events } = makeSession("CASUAL");
    session.disconnect("p1");
    expect(events.some((e) => e.event === "opponent_disconnected")).toBe(true);

    vi.advanceTimersByTime(DISCONNECT_GRACE_MS - 1000);
    const resumed = session.resume("p1");

    expect(resumed).toBe(true);
    expect(events.some((e) => e.event === "opponent_reconnected")).toBe(true);
    expect(events.some((e) => e.event === "game_over")).toBe(false);
  });

  it("abandonment past grace window forfeits to opponent", () => {
    const { session, events } = makeSession("CASUAL");
    session.disconnect("p1");

    vi.advanceTimersByTime(DISCONNECT_GRACE_MS);

    const gameOver = events.find((e) => e.event === "game_over")!;
    expect(gameOver.payload).toEqual({ winner: "P2", reason: "abandon" });
  });
});

describe("MatchSession — match history persistence (2.14)", () => {
  it("persists a FINISHED match row with winner after game_over", () => {
    const { session, store } = makeSession("CASUAL");
    session.resign("p1");
    const history = store.matchHistoryFor("p1");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: "m1", state: "FINISHED", winner: "p2" });
    void session;
  });
});

describe("MatchSession — Shared Match Clock (shared-match-timer)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ticks down the single shared clock regardless of whose turn it is, and emits clock_tick", () => {
    const { session, events } = makeSession("CASUAL");
    const initial = session.state.matchClockMs;
    vi.advanceTimersByTime(1000);
    const tick = events.find((e) => e.event === "clock_tick") as
      | { payload: { matchClockMs: number } }
      | undefined;
    expect(tick).toBeDefined();
    expect(tick!.payload.matchClockMs).toBeLessThan(initial);
    expect(session.state.matchClockMs).toBeLessThan(initial);
  });

  it("recomputes the clock from Date.now() instead of decrementing per tick (no accumulated drift)", () => {
    const { session } = makeSession("CASUAL");
    const initial = session.state.matchClockMs;
    vi.advanceTimersByTime(10_000);
    expect(session.state.matchClockMs).toBe(initial - 10_000);
  });

  it("ends the match by piece-count majority when the shared clock expires — NOT an automatic loss for whoever had the turn", () => {
    const { session, events } = makeSession("CASUAL");
    // P1 starts with 3 cells vs P2's 3 cells; no moves made, so majority is a
    // draw — the important assertion is `reason` still fires via the clock
    // and the winner is computed by the majority rule, not "P2 always wins
    // because it was P1's turn when the clock hit 0" (the old sudden-death
    // behavior this test used to assert).
    vi.advanceTimersByTime(3 * 60 * 1000); // default clock is 3 minutes
    const gameOver = events.find((e) => e.event === "game_over")!;
    expect(gameOver.payload).toMatchObject({ winner: null, reason: "timeout" });
    void session;
  });
});
