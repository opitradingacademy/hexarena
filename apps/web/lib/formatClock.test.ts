import { describe, expect, it } from "vitest";
import { formatClock } from "./formatClock";

describe("formatClock", () => {
  it("formats 3 minutes exactly as mm:ss", () => {
    expect(formatClock(3 * 60 * 1000)).toBe("03:00");
  });

  it("formats sub-minute remaining time, zero-padded", () => {
    expect(formatClock(9 * 1000)).toBe("00:09");
  });

  it("floors partial seconds instead of rounding up", () => {
    expect(formatClock(1999)).toBe("00:01");
  });

  it("clamps negative/expired clocks to 00:00", () => {
    expect(formatClock(-500)).toBe("00:00");
  });
});
