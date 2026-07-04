import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MatchSession } from "./matchSession";
import { MemoryLedgerStore } from "./ledger/memoryStore";
import { creditDeposit, balanceOf } from "./ledger/ledger";
import { DISCONNECT_GRACE_MS } from "@hexarena/shared/protocol";
import { BOT_USER_ID } from "@hexarena/shared/domain/bot";
import { legalMoves, type PlayerId } from "@hexarena/shared/domain/board";

function makeSession(
  mode: "CASUAL" | "ARENA",
  stake = 0.1,
  opts: { botPlayer?: PlayerId; p2?: string; turnTimeoutMs?: number } = {},
) {
  const store = new MemoryLedgerStore();
  const p2 = opts.p2 ?? "p2";
  store.upsertUser("p1", "0x1");
  store.upsertUser(p2, "0x2");
  if (mode === "ARENA") {
    creditDeposit(store, "p1", "0xtxp1", stake);
    creditDeposit(store, p2, "0xtxp2", stake);
  }
  const events: { userId: string; event: string; payload: unknown }[] = [];
  const session = new MatchSession({
    matchId: "m1",
    mode,
    stake,
    players: { P1: "p1", P2: p2 },
    store,
    botPlayer: opts.botPlayer,
    turnTimeoutMs: opts.turnTimeoutMs,
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
    // Isolated from the turn-timeout anti-stalling rule (a separate concern,
    // see "turn-timeout forfeit" below) via a turnTimeoutMs longer than the
    // shared clock, so this test can still simulate "nobody moves for the
    // whole match" without tripping the 45s forfeit first.
    const { session, events } = makeSession("CASUAL", 0.1, { turnTimeoutMs: 4 * 60 * 1000 });
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

describe("MatchSession — local bot opponent (CASUAL)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("makes an automatic move for the bot after the human plays, once the delay elapses", () => {
    const { session, events } = makeSession("CASUAL", 0, { botPlayer: "P2", p2: BOT_USER_ID });
    const moves = events.filter((e) => e.event === "move_result");
    expect(moves).toHaveLength(0);

    const legalP1Move = legalMoves(session.state, "P1")[0];
    session.makeMove("p1", legalP1Move);
    expect(session.state.turn).toBe("P2");

    // Bot hasn't moved yet — it's waiting out BOT_MOVE_DELAY_MS.
    expect(events.filter((e) => e.event === "move_result")).toHaveLength(1);

    vi.advanceTimersByTime(1000);

    const afterBot = events.filter((e) => e.event === "move_result");
    expect(afterBot).toHaveLength(2);
    expect(afterBot[1].payload).toMatchObject({ by: "P2" });
    expect(session.state.turn).toBe("P1");
  });

  it("never schedules a bot move once the match is finished", () => {
    const { session, events } = makeSession("CASUAL", 0, { botPlayer: "P2", p2: BOT_USER_ID });
    session.resign("p1");
    events.length = 0;

    vi.advanceTimersByTime(5000);

    expect(events.filter((e) => e.event === "move_result")).toHaveLength(0);
  });

});

describe("MatchSession — turn-timeout forfeit (anti-stalling)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("forfeits to the opponent if the current turn holder never moves", () => {
    const { session, events } = makeSession("CASUAL");
    expect(session.state.turn).toBe("P1");

    vi.advanceTimersByTime(45_000);

    const gameOver = events.find((e) => e.event === "game_over")!;
    expect(gameOver.payload).toMatchObject({ winner: "P2", reason: "turn-timeout" });
  });

  it("does not forfeit if the turn holder moves before the timeout elapses", () => {
    const { session, events } = makeSession("CASUAL");
    const legalP1Move = legalMoves(session.state, "P1")[0];

    vi.advanceTimersByTime(44_000);
    session.makeMove("p1", legalP1Move);
    vi.advanceTimersByTime(44_000);

    expect(events.find((e) => e.event === "game_over")).toBeUndefined();
  });

  it("resets the timeout window for each new turn holder", () => {
    const { session, events } = makeSession("CASUAL");
    const legalP1Move = legalMoves(session.state, "P1")[0];
    session.makeMove("p1", legalP1Move);
    expect(session.state.turn).toBe("P2");

    // P2 now gets a fresh 45s window — stalling from P1's earlier turn
    // must not carry over and prematurely forfeit P2.
    vi.advanceTimersByTime(44_000);
    expect(events.find((e) => e.event === "game_over")).toBeUndefined();

    vi.advanceTimersByTime(1_000);
    const gameOver = events.find((e) => e.event === "game_over")!;
    expect(gameOver.payload).toMatchObject({ winner: "P1", reason: "turn-timeout" });
  });

  it("does not forfeit a stalled turn while the disconnect grace window is active — abandon takes precedence", () => {
    const { session, events } = makeSession("CASUAL");
    session.disconnect("p1");

    vi.advanceTimersByTime(45_000); // past both the turn-timeout and DISCONNECT_GRACE_MS
    const gameOver = events.find((e) => e.event === "game_over")!;
    expect(gameOver.payload).toMatchObject({ winner: "P2", reason: "abandon" });
  });

  it("restarts the turn-timeout clock after a reconnect", () => {
    const { session, events } = makeSession("CASUAL");
    session.disconnect("p1");
    session.resume("p1");
    events.length = 0;

    vi.advanceTimersByTime(45_000);

    const gameOver = events.find((e) => e.event === "game_over")!;
    expect(gameOver.payload).toMatchObject({ winner: "P2", reason: "turn-timeout" });
  });
});
