/**
 * Chain withdraw adapter — real viem implementation (PR1 of cash-out).
 *
 * Calls `ArenaSettlement.withdrawUser(withdrawalId, to, amountRaw)` on
 * Celo Mainnet. The caller pre-hashes any user-facing identifier
 * (idempotency key) to a bytes32 — this layer is a thin signer and
 * does NOT hash the input again. Replays are safe on-chain because
 * the contract's `withdrawn[withdrawalId]` guard rejects duplicates.
 *
 * Fee absorption: the USDT token on Celo Mainnet charges ~1.5% on each
 * transfer (community fund fee embedded in the token). The contract
 * is called with the GROSS amount so the user nets close to
 * `amountUSD`. The server's ledger debits the user by `amountUSD`
 * (user-facing), NOT `amountRaw` — the delta is operator absorption
 * cost, not user-visible.
 *
 * The operator signing key is read from `OPERATOR_PRIVATE_KEY` (same
 * env var as settleOnChain).
 */
import { createWalletClient, http, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { ARENA_SETTLEMENT_ABI, ARENA_SETTLEMENT_ADDRESS } from "@hexarena/shared/chain";
import { CASHOUT_FEE_DIVISOR } from "../ledger/ledger";

/**
 * Re-exported so tests can assert against the canonical fee-absorption
 * constant. Source of truth lives in ledger.ts; the chain layer reads
 * the same value at runtime.
 */
export { CASHOUT_FEE_DIVISOR };

export type WithdrawOnChainResult = {
  txHash: string;
  amountUSD: number;
  /** Gross amount signed to the contract (amountUSD / 0.985). */
  amountRaw: number;
  /** Operator-absorption cost = amountRaw - amountUSD. */
  feeAbsorbedUSD: number;
};

export type WithdrawOnChainParams = {
  /**
   * 32-byte hash (0x-prefixed hex) identifying this cash-out on-chain.
   * The endpoint derives this as `keccak256(idempotencyKey)` so the
   * on-chain `withdrawn[withdrawalId]` guard serves as the
   * ultimate idempotency authority — DB loss does not enable a
   * double-payout.
   */
  withdrawalId: `0x${string}`;
  to: `0x${string}`;
  amountUSD: number;
};

const DEFAULT_RPC_URL = "https://forno.celo.org";
/** USDT (the ArenaSettlement settlement token) uses 6 decimals on Celo. */
const SETTLEMENT_TOKEN_DECIMALS = 6;

/**
 * Selector of the `AlreadyWithdrawn(bytes32)` custom error in
 * `ArenaSettlement.sol`. We match the FIRST 4 bytes of the revert
 * data so we can distinguish "this withdrawal was already settled
 * on-chain" (idempotent — return cached state) from a real revert
 * (InsufficientFloat, NotOperator, etc.).
 *
 * Computed: keccak256("AlreadyWithdrawn(bytes32)")[0:4] = 0xc4e4c7d9.
 * Hardcoding the constant is intentional — recomputing it at runtime
 * costs a keccak hash on every revert and the ABI is immutable.
 */
export const ALREADY_WITHDRAWN_SELECTOR = "0xc4e4c7d9" as const;

/**
 * Selector of the `InsufficientFloat(uint256,uint256)` custom error.
 * Previously misidentified as ALREADY_WITHDRAWN_SELECTOR (0x51dd3741
 * is actually this error, not AlreadyWithdrawn) — that bug caused the
 * server to burn 3 retry attempts rotating withdrawalId hashes on a
 * float shortage that no amount of retrying could fix, then surface a
 * misleading "AlreadyWithdrawn"-flavored failure instead of the real
 * cause. Computed: keccak256("InsufficientFloat(uint256,uint256)")[0:4].
 */
export const INSUFFICIENT_FLOAT_SELECTOR = "0x51dd3741" as const;

/**
 * Returns true iff the error message from a viem
 * `ContractFunctionExecutionError` looks like the on-chain
 * `AlreadyWithdrawn` revert. Used by `cashoutEndpoint.ts` to decide
 * between "idempotent replay (200)" and "terminal failure (422)".
 *
 * viem embeds the raw revert data in the error message inside the
 * "Details:" footer and ALSO in `error.data` / `error.cause.data` —
 * we check the message because that's the most stable surface across
 * viem 2.x minor versions.
 */
export function isAlreadyWithdrawnRevert(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const msg = (e as { message?: string; shortMessage?: string }).message ?? "";
  const short = (e as { shortMessage?: string }).shortMessage ?? "";
  return msg.includes(ALREADY_WITHDRAWN_SELECTOR) || short.includes(ALREADY_WITHDRAWN_SELECTOR);
}

/**
 * Returns true iff the error looks like the on-chain `InsufficientFloat`
 * revert — the operator's prize float doesn't hold enough of the
 * settlement token to cover this withdrawal. Retrying with a different
 * `withdrawalId` can never fix this (the float doesn't change), so the
 * caller should surface a distinct, actionable failure instead of
 * burning retry attempts.
 */
export function isInsufficientFloatRevert(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const msg = (e as { message?: string; shortMessage?: string }).message ?? "";
  const short = (e as { shortMessage?: string }).shortMessage ?? "";
  return (
    msg.includes(INSUFFICIENT_FLOAT_SELECTOR) || short.includes(INSUFFICIENT_FLOAT_SELECTOR)
  );
}

export async function withdrawUsdtOnChain(
  params: WithdrawOnChainParams,
): Promise<WithdrawOnChainResult> {
  const { withdrawalId, to, amountUSD } = params;

  const privateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("OPERATOR_PRIVATE_KEY is not set — cannot sign withdrawUser() transactions");
  }

  const rpcUrl = process.env.CELO_MAINNET_RPC_URL || DEFAULT_RPC_URL;
  const contractAddress = ARENA_SETTLEMENT_ADDRESS[celo.id];
  if (!contractAddress) {
    throw new Error(`No ArenaSettlement address configured for chainId ${celo.id}`);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: http(rpcUrl),
  });

  // Lazy-load so tests that mock the constant get the same value.
  const amountRaw = amountUSD / CASHOUT_FEE_DIVISOR;

  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: ARENA_SETTLEMENT_ABI,
    functionName: "withdrawUser",
    args: [
      withdrawalId,
      to as Address,
      parseUnits(amountRaw.toFixed(SETTLEMENT_TOKEN_DECIMALS), SETTLEMENT_TOKEN_DECIMALS),
    ],
  });

  return {
    txHash,
    amountUSD,
    amountRaw,
    feeAbsorbedUSD: amountRaw - amountUSD,
  };
}
