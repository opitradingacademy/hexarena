import { describe, expect, it } from "vitest";
import { shortenAddress } from "./shortenAddress";

describe("shortenAddress", () => {
  it("truncates a canonical wallet to 0x + 4 + ellipsis + 4 hex chars", () => {
    expect(shortenAddress("0x34D5d015B4805E985619D0F4aaCb6343a6457fF2")).toBe("0x34D5…7fF2");
  });

  it("truncates a lowercase wallet the same way (case preserved)", () => {
    expect(shortenAddress("0x34d5d015b4805e985619d0f4aacb6343a6457ff2")).toBe("0x34d5…7ff2");
  });

  it("returns the input unchanged if it is shorter than the minimum truncatable length", () => {
    expect(shortenAddress("0x1234")).toBe("0x1234");
  });
});
