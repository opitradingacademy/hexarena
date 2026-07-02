import { describe, expect, it } from "vitest";
import { formatUSD } from "./formatUSD";

describe("formatUSD", () => {
  it("formats a whole dollar amount with two decimals", () => {
    expect(formatUSD(4)).toBe("$4.00");
  });

  it("formats a fractional amount rounded to cents", () => {
    expect(formatUSD(0.9)).toBe("$0.90");
  });

  it("formats zero balance", () => {
    expect(formatUSD(0)).toBe("$0.00");
  });

  it("formats negative amounts with a leading minus before the dollar sign", () => {
    expect(formatUSD(-0.1)).toBe("-$0.10");
  });
});
