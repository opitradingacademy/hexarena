import { describe, expect, it } from "vitest";
import { validateTreasuryAddress } from "./indexEnv";

describe("validateTreasuryAddress", () => {
  it("accepts a 40-hex-char (20-byte) address", () => {
    const ok = validateTreasuryAddress("0xf3a3477c9df43f9ae57f4ffb2f353abde3b16f84");
    expect(ok).toBe("0xf3a3477c9df43f9ae57f4ffb2f353abde3b16f84");
  });

  it("lowercases the input", () => {
    expect(validateTreasuryAddress("0xF3A3477C9DF43F9AE57F4FFB2F353ABDE3B16F84")).toBe(
      "0xf3a3477c9df43f9ae57f4ffb2f353abde3b16f84",
    );
  });

  it("rejects an address that's too long (32 bytes, 64 hex)", () => {
    expect(() =>
      validateTreasuryAddress("0xf3a3477c9df43f9ae57f4ffb2f353abde3b16f84b88d386cda524a777d04f12b"),
    ).toThrow(/wrong length/);
  });

  it("rejects an address that's too short", () => {
    expect(() => validateTreasuryAddress("0x1234")).toThrow(/20 bytes/);
  });

  it("rejects a value without 0x prefix", () => {
    expect(() => validateTreasuryAddress("f3a3477c9df43f9ae57f4ffb2f353abde3b16f84")).toThrow(
      /0x prefix/,
    );
  });

  it("rejects a non-hex value", () => {
    expect(() => validateTreasuryAddress("0xZZZZ477c9df43f9ae57f4ffb2f353abde3b16f84")).toThrow(
      /hex/,
    );
  });

  it("rejects an empty string", () => {
    expect(() => validateTreasuryAddress("")).toThrow(/empty/);
  });
});
