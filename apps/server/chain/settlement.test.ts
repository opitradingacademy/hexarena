import { afterEach, describe, expect, it, vi } from "vitest";

const writeContract = vi.fn().mockResolvedValue("0xrealtxhash");

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createWalletClient: vi.fn(() => ({ writeContract })),
    http: vi.fn(() => "http-transport"),
  };
});

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({ address: "0xoperator" })),
}));

describe("settleOnChain", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    writeContract.mockClear();
  });

  it("calls ArenaSettlement.settle() with matchId hashed to bytes32, winner address, amount in token units", async () => {
    vi.stubEnv("OPERATOR_PRIVATE_KEY", "0xabc123");
    const { settleOnChain } = await import("./settlement");

    const result = await settleOnChain(
      "550e8400-e29b-41d4-a716-446655440000",
      "0x000000000000000000000000000000000000aa",
      0.16,
    );

    expect(writeContract).toHaveBeenCalledTimes(1);
    const call = writeContract.mock.calls[0][0];
    expect(call.functionName).toBe("settle");
    expect(call.args[0]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(call.args[1]).toBe("0x000000000000000000000000000000000000aa");
    expect(call.args[2]).toBe(160000n); // 0.16 USD at 6-decimal USDT units
    expect(result.txHash).toBe("0xrealtxhash");
  });

  it("throws a clear error when OPERATOR_PRIVATE_KEY is unset", async () => {
    vi.stubEnv("OPERATOR_PRIVATE_KEY", "");
    vi.resetModules();
    const { settleOnChain } = await import("./settlement");

    await expect(settleOnChain("m1", "0x000000000000000000000000000000000000aa", 0.1)).rejects.toThrow(
      /OPERATOR_PRIVATE_KEY/,
    );
  });
});
