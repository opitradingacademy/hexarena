import { describe, expect, it } from "vitest";
import { Matchmaker } from "./matchmaking";

describe("Matchmaker", () => {
  it("pairs two casual clients", () => {
    const mm = new Matchmaker();
    expect(mm.join({ userId: "a", mode: "CASUAL" })).toBeNull();
    const pair = mm.join({ userId: "b", mode: "CASUAL" });
    expect(pair).toEqual([
      { userId: "a", mode: "CASUAL" },
      { userId: "b", mode: "CASUAL" },
    ]);
  });

  it("pairs arena clients only with matching stake", () => {
    const mm = new Matchmaker();
    expect(mm.join({ userId: "a", mode: "ARENA", stake: 0.5 })).toBeNull();
    expect(mm.join({ userId: "b", mode: "ARENA", stake: 0.1 })).toBeNull();
    const pair = mm.join({ userId: "c", mode: "ARENA", stake: 0.5 });
    expect(pair?.[0].userId).toBe("a");
    expect(pair?.[1].userId).toBe("c");
  });

  it("cancel removes a queued entry", () => {
    const mm = new Matchmaker();
    mm.join({ userId: "a", mode: "CASUAL" });
    expect(mm.cancel("a")).toBe(true);
    expect(mm.join({ userId: "b", mode: "CASUAL" })).toBeNull();
  });

  it("does NOT match a user with themselves when their own entry is still queued", () => {
    // Production 2026-07-03: a user reconnects to matchmaking with
    // the same wallet address (so the same userId stays in the
    // socket-auth handshake). Their previous queue entry was never
    // cancelled (cancel_queue only fires on user action, not on
    // socket disconnect), so when they re-enter the queue,
    // matchmaker.join shifts their own entry, pairs, and a 1-vs-1
    // match starts/ends in <1s, kicking the user back to the
    // matchmaking screen with no opponent.
    const mm = new Matchmaker();
    expect(mm.join({ userId: "alice", mode: "ARENA", stake: 0.1 })).toBeNull();
    // Alice reconnects — same wallet, same userId.
    const second = mm.join({ userId: "alice", mode: "ARENA", stake: 0.1 });
    expect(second).toBeNull();
  });
});
