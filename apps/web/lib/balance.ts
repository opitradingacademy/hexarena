import { SETTLEMENT_TOKEN_ADDRESS } from "@hexarena/shared/chain";

type EthereumRequestFn = (args: { method: string; params?: unknown[] }) => Promise<unknown>;

type EthereumProviderLike = { request: EthereumRequestFn };

/**
 * EIP-1193 provider used as the read transport for USDT balanceOf.
 * On physical MiniPay, `forno.celo.org` (the public RPC) is blocked by
 * the WebView's CORS policy — only the WebView's internal RPC, exposed
 * via the injected provider, reaches the chain reliably. The previously-
 * working reference Mini App does the same thing (raw eth_call, no viem,
 * no `forno`). See docs.minipay.xyz → Retrieve Balance.
 */
export async function getUsdtBalance(
  walletAddress: string | null,
  provider: EthereumProviderLike,
): Promise<number | null> {
  if (!walletAddress) return null;

  // balanceOf(address) -> uint256 selector + 32-byte left-padded address.
  const selector = "0x70a08231";
  const data =
    selector + "000000000000000000000000" + walletAddress.toLowerCase().replace(/^0x/, "");

  const raw = (await provider.request({
    method: "eth_call",
    params: [{ to: SETTLEMENT_TOKEN_ADDRESS[42220], data }, "latest"],
  })) as string;

  return Number(BigInt(raw)) / 1e6;
}
