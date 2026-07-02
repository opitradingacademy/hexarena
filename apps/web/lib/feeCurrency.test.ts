import { describe, expect, it } from "vitest";
import { getFeeCurrencyAddress, type SupportedFeeAsset } from "./feeCurrency";

describe("getFeeCurrencyAddress", () => {
  it("returns the USDm fee-currency adapter address by default", () => {
    expect(getFeeCurrencyAddress("USDm")).toBe(
      "0x765DE816845861e75A25fCA122bb6898B8B1282a",
    );
  });

  it("returns the USDC fee-currency adapter address", () => {
    expect(getFeeCurrencyAddress("USDC")).toBe(
      "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
    );
  });

  it("returns the USDT fee-currency adapter address", () => {
    expect(getFeeCurrencyAddress("USDT")).toBe(
      "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72",
    );
  });

  it("throws for an unsupported asset (e.g. CELO must never be user-visible/selectable)", () => {
    expect(() => getFeeCurrencyAddress("CELO" as SupportedFeeAsset)).toThrow(
      /unsupported/i,
    );
  });
});
