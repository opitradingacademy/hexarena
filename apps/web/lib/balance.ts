import { createPublicClient, http, type Address } from "viem";
import { celo } from "viem/chains";
import { SETTLEMENT_TOKEN_ADDRESS } from "@hexarena/shared/chain";

type CeloPublicClient = ReturnType<typeof createPublicClient<ReturnType<typeof http>, typeof celo>>;

const USDT_ADDRESS = SETTLEMENT_TOKEN_ADDRESS[42220] as Address;

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export function getCeloPublicClient(): CeloPublicClient {
  const rpcUrl = process.env.NEXT_PUBLIC_CELO_RPC_URL ?? "https://forno.celo.org";
  return createPublicClient({ chain: celo, transport: http(rpcUrl) });
}

/**
 * Reads the USDT balance for a wallet on Celo Mainnet and converts it from
 * 6-decimal on-chain units to a plain USD number. Returns null when there
 * is no wallet address (Dashboard shows $0.00 in that case).
 */
export async function getUsdtBalance(
  walletAddress: string | null,
  client: Pick<CeloPublicClient, "readContract">,
): Promise<number | null> {
  if (!walletAddress) return null;
  const raw = (await client.readContract({
    address: USDT_ADDRESS,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [walletAddress as Address],
  })) as bigint;
  return Number(raw) / 1e6;
}
