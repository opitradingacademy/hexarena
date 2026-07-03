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
 * EIP-1193 provider. Returns the transaction hash once the user signs.
 *
 * MiniPay-specific (and Celo-specific) transaction shape — verified
 * against the working reference Mini App (zorritoclaude) and the
 * MiniPay docs:
 *
 *   - `type: 0` (legacy EIP-155). MiniPay's WebView provider-stub does
 *     NOT accept CIP-64 (type 0x7b) txs; it reverts with bare
 *     "execution reverted". The Celo mainline docs (docs.celo.org)
 *     recommend 0x7b for feeCurrency support, but that advice targets
 *     standard celo clients, NOT the MiniPay WebView. The reference
 *     Mini App's docs.html says: "MiniPay only accepts legacy
 *     transactions (type 0)".
 *
 *   - `gasPrice` MUST be explicit. MiniPay's WebView doesn't reliably
 *     populate it for ERC-20 transfers. We fetch it via
 *     `eth_gasPrice` and pass it as a number.
 *
 *   - NO `feeCurrency`. Legacy type 0 txs pay gas in CELO. MiniPay
 *     users always have a small CELO balance; this is the path the
 *     reference Mini App uses and what MiniPay's wallet chip expects.
 *     Adding `feeCurrency` to a type 0 tx has the same revert — the
 *     provider doesn't know what to do with the parameter.
 *
 *   - NO `gas` (let the provider estimate; eth_estimateGas works on
 *     the simulated tx once type 0 + gasPrice are set).
 *
 *   - The recipient of the funds is in the call `data`, NOT in
 *     `to`. The tx `to` is always the USDT token contract. Don't
 *     confuse the two.
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
  const gasPriceHex = (await args.ethereum.request({
    method: "eth_gasPrice",
  })) as `0x${string}`;
  const gasPrice = BigInt(gasPriceHex);
  const txParams = {
    from: args.from,
    to: tokenAddress,
    data,
    type: 0 as const, // legacy — MiniPay's WebView only accepts this
    gasPrice: "0x" + gasPrice.toString(16), // pass as hex string, provider formats it
  };
  console.log("[HexArena:txParams]", JSON.stringify(txParams, null, 2));
  try {
    const txHash = (await args.ethereum.request({
      method: "eth_sendTransaction",
      params: [txParams],
    })) as `0x${string}`;
    return txHash;
  } catch (e) {
    const err = e as Error & { code?: number; data?: unknown };
    console.log("[HexArena:txError]", err);
    const detail = err.data ?? err.message ?? "unknown error";
    throw new Error(
      `submitUsdtTransfer reverted: code=${err.code ?? "?"} ` +
        `data=${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
    );
  }
}
