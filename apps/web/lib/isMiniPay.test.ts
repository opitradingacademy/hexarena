import { describe, expect, it } from "vitest";
import { isMiniPay } from "./isMiniPay";

describe("isMiniPay", () => {
  it("returns true when window.ethereum.isMiniPay is true", () => {
    const ethereum = { isMiniPay: true } as unknown as { isMiniPay?: boolean };
    expect(isMiniPay(ethereum)).toBe(true);
  });

  it("returns false when ethereum provider is undefined (standard browser)", () => {
    expect(isMiniPay(undefined)).toBe(false);
  });

  it("returns false when an injected provider exists but is not MiniPay", () => {
    const ethereum = { isMiniPay: false } as unknown as { isMiniPay?: boolean };
    expect(isMiniPay(ethereum)).toBe(false);
  });
});
