/**
 * Chain settlement adapter — real viem implementation (PR5).
 *
 * Calls `ArenaSettlement.settle(matchId, winner, amount)` on Celo Mainnet
 * per design.md D1/D2 and arena-settlement spec "Settlement Idempotency Per
 * Match" / "Operator-Only Settlement Access". The operator signing key is
 * never hardcoded — read from `OPERATOR_PRIVATE_KEY` (see `.env.example`).
 */
import { createWalletClient, http, keccak256, parseUnits, toBytes, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { ARENA_SETTLEMENT_ABI, ARENA_SETTLEMENT_ADDRESS } from "@hexarena/shared/chain";

export type SettleOnChainResult = { txHash: string };

const DEFAULT_RPC_URL = "https://forno.celo.org";
/** USDT (the ArenaSettlement settlement token) uses 6 decimals on Celo. */
const SETTLEMENT_TOKEN_DECIMALS = 6;

/**
 * `matchId` is a UUID, not natively `bytes32` — hash it deterministically so
 * `settled[matchId]` idempotency in the contract has a stable key per match.
 */
function matchIdToBytes32(matchId: string): `0x${string}` {
  return keccak256(toBytes(matchId));
}

export async function settleOnChain(
  matchId: string,
  winner: string,
  amount: number,
): Promise<SettleOnChainResult> {
  const privateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("OPERATOR_PRIVATE_KEY is not set — cannot sign settle() transactions");
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

  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: ARENA_SETTLEMENT_ABI,
    functionName: "settle",
    args: [matchIdToBytes32(matchId), winner as Address, parseUnits(amount.toFixed(SETTLEMENT_TOKEN_DECIMALS), SETTLEMENT_TOKEN_DECIMALS)],
  });

  return { txHash };
}
