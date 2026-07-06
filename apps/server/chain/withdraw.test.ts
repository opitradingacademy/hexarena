import { afterEach, describe, expect, it, vi } from "vitest";
import { keccak256, toBytes } from "viem";

const writeContract = vi.fn().mockResolvedValue("0xwithdrawtxhash");

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

describe("withdrawUsdtOnChain", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    writeContract.mockClear();
  });

  it("computes amountRaw = amountUSD / 0.985 and signs withdrawUser on the contract", async () => {
    vi.stubEnv("OPERATOR_PRIVATE_KEY", "0xabc123");
    const { withdrawUsdtOnChain } = await import("./withdraw");

    const result = await withdrawUsdtOnChain({
      withdrawalId: "550e8400-e29b-41d4-a716-446655440000",
      to: "0x000000000000000000000000000000000000aa",
      amountUSD: 1.0,
    });

    expect(writeContract).toHaveBeenCalledTimes(1);
    const call = writeContract.mock.calls[0][0];
    // Function name MUST be the user-facing withdrawUser (NOT settle and
    // NOT a raw USDT.transfer — single contract path per design).
    expect(call.functionName).toBe("withdrawUser");
    // Args: hashed withdrawalId, recipient, amountRaw in 6-decimal units.
    expect(call.args[0]).toBe(keccak256(toBytes("550e8400-e29b-41d4-a716-446655440000")));
    expect(call.args[1]).toBe("0x000000000000000000000000000000000000aa");
    // 1.00 / 0.985 = 1.015228426395939, rounded to 6-decimal precision = 1.015228
    // → 1015228 raw (6 decimals). We assert the call ran with a value
    // >= amountUSD (gross-up) and the exposed fee absorbed > 0.
    expect(call.args[2]).toBe(1_015_228n);
    expect(result.txHash).toBe("0xwithdrawtxhash");
    expect(result.amountUSD).toBe(1.0);
    expect(result.amountRaw).toBeGreaterThan(1.0);
    expect(result.feeAbsorbedUSD).toBeCloseTo(1.0 / 0.985 - 1.0, 6);
  });

  it("computes amountRaw correctly at boundary values: 0.10, 1.00, 100.00", async () => {
    vi.stubEnv("OPERATOR_PRIVATE_KEY", "0xabc123");
    const { withdrawUsdtOnChain } = await import("./withdraw");

    const cases: Array<{ amountUSD: number; expectedRaw: bigint }> = [
      // 0.10 / 0.985 = 0.1015228426395939 → 0.101523 → 101523 raw
      { amountUSD: 0.1, expectedRaw: 101_523n },
      // 1.00 / 0.985 = 1.0152284263959390 → 1.015228 → 1015228 raw
      { amountUSD: 1.0, expectedRaw: 1_015_228n },
      // 100.00 / 0.985 = 101.52284263959390 → 101.522843 → 101522843 raw
      { amountUSD: 100.0, expectedRaw: 101_522_843n },
    ];

    for (const { amountUSD, expectedRaw } of cases) {
      writeContract.mockClear();
      await withdrawUsdtOnChain({
        withdrawalId: "550e8400-e29b-41d4-a716-446655440000",
        to: "0x000000000000000000000000000000000000aa",
        amountUSD,
      });
      const call = writeContract.mock.calls[0][0];
      expect(call.args[2]).toBe(expectedRaw);
    }
  });

  it("throws a clear error when OPERATOR_PRIVATE_KEY is unset", async () => {
    vi.stubEnv("OPERATOR_PRIVATE_KEY", "");
    vi.resetModules();
    const { withdrawUsdtOnChain } = await import("./withdraw");

    await expect(
      withdrawUsdtOnChain({
        withdrawalId: "m1",
        to: "0x000000000000000000000000000000000000aa",
        amountUSD: 0.1,
      }),
    ).rejects.toThrow(/OPERATOR_PRIVATE_KEY/);
  });

  it("amountRaw always exceeds amountUSD (operator absorbs the ~1.5% fee, never the user)", async () => {
    vi.stubEnv("OPERATOR_PRIVATE_KEY", "0xabc123");
    const { withdrawUsdtOnChain, CASHOUT_FEE_DIVISOR } = await import("./withdraw");

    expect(CASHOUT_FEE_DIVISOR).toBe(0.985);

    for (const amountUSD of [0.1, 0.5, 1.0, 5.0, 50.0]) {
      const r = await withdrawUsdtOnChain({
        withdrawalId: "550e8400-e29b-41d4-a716-446655440000",
        to: "0x000000000000000000000000000000000000aa",
        amountUSD,
      });
      // The user-facing amount is unchanged on the way out; the
      // operator signs a grossed-up value so the on-chain fee lands
      // on the operator's side.
      expect(r.amountUSD).toBe(amountUSD);
      expect(r.amountRaw).toBeGreaterThan(amountUSD);
      expect(r.amountRaw).toBeCloseTo(amountUSD / 0.985, 4);
      expect(r.feeAbsorbedUSD).toBeCloseTo(r.amountRaw - amountUSD, 4);
    }
  });
});
