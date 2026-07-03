import { FEE_CURRENCY_ADAPTER, SETTLEMENT_TOKEN_ADDRESS } from "@hexarena/shared/chain";

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
 * Important MiniPay/Celo-specific quirks (each one cost an iteration
 * during the Arena deposit flow — see git log for the trail):
 *   1. `feeCurrency` MUST be the USDT adapter address, NOT the token
 *      address. Without `feeCurrency`, the MiniPay provider calls
 *      `eth_estimateGas`, finds no supported gas token for the chosen
 *      ERC-20, and reverts the simulation with a bare
 *      "execution reverted". Verified against docs.minipay.xyz
 *      → technical-references/send-transaction.
 *   2. `type: "0x7b"` (CIP-64) MUST be set on Celo transactions that
 *      use `feeCurrency`. Celo Mainnet rejects Celo's legacy type (0)
 *      with feeCurrency — and `feeCurrency` is the only way to fund
 *      gas in USDT for a USDT ERC-20 transfer. Without this field,
 *      the chain treats the tx as a legacy EIP-1559-less legacy tx and
 *      feeCurrency is silently ignored, leaving gas unpayable.
 *      See docs.celo.org → build-on-celo/fee-abstraction/using-fee-abstraction
 *      → "Prepare the Transaction" → "type: '0x7b'".
 *   3. NO `maxFeePerGas`/`maxPriorityFeePerGas` fields — type 0x7b
 *      manages gas differently. Adding them is a no-op for this type
 *      but `eth_estimateGas` may panic if they're inconsistent.
 *   4. We send the token's contract address as `to`, and the encoded
 *      `transfer(to, amount)` call data (NOT the user-supplied `to`).
 *      Do not confuse the recipient of the funds (`args.to`) with the
 *      contract the tx targets (`SETTLEMENT_TOKEN_ADDRESS[42220]`).
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
  const txParams = {
    from: args.from,
    to: tokenAddress,
    data,
    feeCurrency,
    type: "0x7b", // CIP-64 transaction type — required for feeCurrency on Celo
  } as unknown as Record<string, unknown>;
  // Diagnostic: log the exact payload before sending. Surfaced both via
  // console.log (DevTools users) and the returned error message so the
  // StakeConfirmDialog can render the JSON in its on-screen error block.
  // In MiniPay's dev-mode WebView the only reliable place to read this
  // back is the modal's error UI, so we throw a tagged error here and
  // let the caller format it for display.
  // eslint-disable-next-line no-console
  console.log("[HexArena:txParams]", JSON.stringify(txParams, null, 2));
  try {
    const txHash = (await args.ethereum.request({
      method: "eth_sendTransaction",
      params: [txParams],
    })) as `0x${string}`;
    return txHash;
  } catch (e) {
    const err = e as Error & { code?: number; data?: unknown };
    // eslint-disable-next-line no-console
    console.log("[HexArena:txError]", err);
    const detail = err.data ?? err.message ?? "unknown error";
    throw new Error(
      `submitUsdtTransfer reverted: code=${err.code ?? "?"} ` +
        `data=${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
    );
  }
}
