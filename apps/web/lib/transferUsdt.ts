import { SETTLEMENT_TOKEN_ADDRESS } from "@hexarena/shared/chain";

/**
 * USDC has 6 decimals on Celo. USDm has 18. We default to 6 because the
 * ArenaSettlement contract on Mainnet is configured with USDT (6
 * decimals). Operators who switch settlement to USDm/USDC adapters must
 * override `settleTokenDecimals` here AND in their `ArenaSettlement`
 * constructor.
 */
const DEFAULT_DECIMALS = 6;

/**
 * EIP-1193 request surface, no-op fields ignored. Allows us to bind the
 * provider's .request() once and not depend on the global window shape.
 */
export type EthereumRequester = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

// keccak("transfer(address,uint256)") = 0xa9059cbb
const TRANSFER_SELECTOR = "a9059cbb";

function pad32(hex: string): string {
  const stripped = hex.toLowerCase().replace(/^0x/, "");
  return stripped.padStart(64, "0");
}

function amountToRaw(amountUSD: number, decimals: number): bigint {
  const factor = 10n ** BigInt(decimals);
  // Use string-based parse to avoid float precision loss on 0.1, 0.25, 0.5.
  const [whole, frac = ""] = amountUSD.toFixed(decimals).split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * factor + BigInt(padded);
}

export function encodeUsdtTransfer(args: {
  to: `0x${string}`;
  amountUSD?: number;
  amountRaw?: bigint;
  decimals?: number;
}): `0x${string}` {
  if (!args.amountUSD && args.amountRaw === undefined) {
    throw new Error("encodeUsdtTransfer: supply amountUSD or amountRaw");
  }
  const decimals = args.decimals ?? DEFAULT_DECIMALS;
  const raw = args.amountRaw ?? amountToRaw(args.amountUSD!, decimals);
  return `0x${TRANSFER_SELECTOR}${pad32(args.to)}${raw.toString(16).padStart(64, "0")}` as `0x${string}`;
}

/**
 * Submits a USDT `transfer(to, amount)` from `from` through the injected
 * EIP-1193 provider. Returns the transaction hash once the user signs
 * and the tx is broadcast.
 *
 * Important: do NOT add `maxFeePerGas`/`maxPriorityFeePerGas` here —
 * MiniPay only supports legacy transactions (type 0) and either field
 * causes a "unsupported field" rejection.
 */
export async function submitUsdtTransfer(args: {
  ethereum: EthereumRequester;
  from: `0x${string}`;
  to: `0x${string}`;
  amountUSD?: number;
  amountRaw?: bigint;
  decimals?: number;
}): Promise<`0x${string}`> {
  const data = encodeUsdtTransfer({
    to: args.to,
    amountUSD: args.amountUSD,
    amountRaw: args.amountRaw,
    decimals: args.decimals,
  });
  const tokenAddress = SETTLEMENT_TOKEN_ADDRESS[42220];
  if (!tokenAddress) {
    throw new Error("No settlement token configured for chain 42220 (Celo Mainnet)");
  }
  const txHash = (await args.ethereum.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: args.from,
        to: tokenAddress,
        data,
      },
    ],
  })) as `0x${string}`;
  return txHash;
}
