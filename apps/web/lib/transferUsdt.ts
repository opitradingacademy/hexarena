import { FEE_CURRENCY_ADAPTER, SETTLEMENT_TOKEN_ADDRESS } from "@hexarena/shared/chain";

/**
 * USDT uses 6 decimals on Celo. USDm uses 18. We default to 6 because the
 * ArenaSettlement contract on Mainnet is configured with USDT.
 */
const DEFAULT_DECIMALS = 6;

/**
 * EIP-1193 request surface, used by the viem custom transport to
 * talk to the injected MiniPay provider.
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
 * Submits a USDT `transfer(to, amount)` via the injected MiniPay provider.
 * Returns the transaction hash once the user signs.
 *
 * Uses viem with a `custom(window.ethereum)` transport — the canonical
 * pattern shown in docs.celo.org/build-on-celo/fee-abstraction/using-fee-abstraction.
 *
 * Critical fields per Celo + MiniPay docs:
 *   - `feeCurrency`: USDT adapter address (NOT the token address).
 *     Set this and the chain debits gas in USDT; the user needs no CELO.
 *   - `type: 'cip64'`: viem's abstract for CIP-64 type 0x7b. viem
 *     serializes this to the byte-0x7b format the chain accepts.
 *
 * viem also handles `account`, `chain`, and `gas estimation` internally,
 * so the `params[0]` shape of the underlying eth_sendTransaction call
 * is built by viem and matches what the docs.celo.org example shows.
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
  const feeCurrency = FEE_CURRENCY_ADAPTER[42220];
  if (!tokenAddress) {
    throw new Error("No settlement token configured for chain 42220 (Celo Mainnet)");
  }
  if (!feeCurrency) {
    throw new Error("No fee-currency adapter configured for chain 42220 (Celo Mainnet)");
  }
  // Lazy-load viem to keep the bundle out of the read path (Dashboard,
  // useUsdtBalance) — viem is only required for tx submission in
  // MatchmakingStakeDialog, which is rare on a given render.
  const viem = await import("viem");
  const { celo } = await import("viem/chains");
  const transport = viem.custom({
    async request({ method, params }) {
      return args.ethereum.request({ method, params: params ?? [] });
    },
  });
  const client = viem.createWalletClient({
    account: args.from,
    chain: celo,
    transport,
  });
  try {
    const txHash = await client.sendTransaction({
      account: args.from,
      to: tokenAddress,
      data,
      feeCurrency,
      // viem's 'cip64' serializes to type 0x7b (CIP-64), the format
      // Celo Mainnet accepts for feeCurrency transactions.
      type: "cip64",
      chain: celo,
    });
    return txHash as `0x${string}`;
  } catch (e) {
    const err = e as Error & { code?: number; data?: unknown };
    const detail = err.data ?? err.message ?? "unknown error";
    throw new Error(
      `submitUsdtTransfer reverted: code=${err.code ?? "?"} ` +
        `data=${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
    );
  }
}
