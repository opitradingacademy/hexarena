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
});
