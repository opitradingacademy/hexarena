/**
 * Chain withdraw adapter — real viem implementation (PR1 of cash-out).
 *
 * Calls `ArenaSettlement.withdrawUser(withdrawalIdHash, to, amountRaw)`
 * on Celo Mainnet. The withdrawalId (a uuid v4) is hashed to bytes32
 * by the contract's idempotency map — replays are safe.
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
import { createWalletClient, http, keccak256, parseUnits, toBytes, type Address } from "viem";
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
  withdrawalId: string;
  to: `0x${string}`;
  amountUSD: number;
};

const DEFAULT_RPC_URL = "https://forno.celo.org";
/** USDT (the ArenaSettlement settlement token) uses 6 decimals on Celo. */
const SETTLEMENT_TOKEN_DECIMALS = 6;

/**
 * `withdrawalId` is a UUID, not natively `bytes32` — hash it
 * deterministically so the contract's `withdrawn[id]` idempotency map
 * has a stable key per request.
 */
function withdrawalIdToBytes32(withdrawalId: string): `0x${string}` {
  return keccak256(toBytes(withdrawalId));
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
      withdrawalIdToBytes32(withdrawalId),
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
