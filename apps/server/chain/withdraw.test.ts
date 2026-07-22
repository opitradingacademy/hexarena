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

/**
 * The endpoint pre-hashes `idempotencyKey` to bytes32. The chain
 * adapter receives that bytes32 directly — these tests mirror the
 * production contract.
 */
const HASHED_ID = keccak256(toBytes("550e8400-e29b-41d4-a716-446655440000"));

describe("withdrawUsdtOnChain", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    writeContract.mockClear();
  });

  it("computes amountRaw = amountUSD / 0.985 and signs withdrawUser on the contract", async () => {
    vi.stubEnv("OPERATOR_PRIVATE_KEY", "0xabc123");
    const { withdrawUsdtOnChain } = await import("./withdraw");

    const result = await withdrawUsdtOnChain({
      withdrawalId: HASHED_ID,
      to: "0x000000000000000000000000000000000000aa",
      amountUSD: 1.0,
    });

    expect(writeContract).toHaveBeenCalledTimes(1);
    const call = writeContract.mock.calls[0][0];
    // Function name MUST be the user-facing withdrawUser (NOT settle and
    // NOT a raw USDT.transfer — single contract path per design).
    expect(call.functionName).toBe("withdrawUser");
    // Args: pre-hashed bytes32, recipient, amountRaw in 6-decimal units.
    expect(call.args[0]).toBe(HASHED_ID);
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
        withdrawalId: HASHED_ID,
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
        withdrawalId: HASHED_ID,
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
        withdrawalId: HASHED_ID,
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

  it("isAlreadyWithdrawnRevert detects the 0xc4e4c7d9 selector in viem ContractFunctionExecutionError", async () => {
    const { isAlreadyWithdrawnRevert } = await import("./withdraw");
    // Mimic the viem error shape produced on a real revert.
    const viemError = new Error(
      "The contract function 'withdrawUser' reverted with the following signature: 0xc4e4c7d9, args: ...",
    );
    expect(isAlreadyWithdrawnRevert(viemError)).toBe(true);

    // Other reverts (InsufficientFloat, NotOperator, generic throw) are NOT
    // mistaken for AlreadyWithdrawn.
    expect(isAlreadyWithdrawnRevert(new Error("execution reverted"))).toBe(false);
    expect(isAlreadyWithdrawnRevert(new Error("network error"))).toBe(false);
    expect(isAlreadyWithdrawnRevert(null)).toBe(false);
    expect(isAlreadyWithdrawnRevert(undefined)).toBe(false);
    expect(isAlreadyWithdrawnRevert("0xc4e4c7d9 raw string")).toBe(false);
    // The (previously mislabeled) InsufficientFloat selector must NOT be
    // mistaken for AlreadyWithdrawn.
    expect(
      isAlreadyWithdrawnRevert(
        new Error(
          "The contract function 'withdrawUser' reverted with the following signature: 0x51dd3741",
        ),
      ),
    ).toBe(false);
  });

  it("isInsufficientFloatRevert detects the 0x51dd3741 selector", async () => {
    const { isInsufficientFloatRevert } = await import("./withdraw");
    const viemError = new Error(
      "The contract function 'withdrawUser' reverted with the following signature: 0x51dd3741, args: ...",
    );
    expect(isInsufficientFloatRevert(viemError)).toBe(true);
    expect(isInsufficientFloatRevert(new Error("execution reverted"))).toBe(false);
    expect(
      isInsufficientFloatRevert(
        new Error(
          "The contract function 'withdrawUser' reverted with the following signature: 0xc4e4c7d9",
        ),
      ),
    ).toBe(false);
  });
});
