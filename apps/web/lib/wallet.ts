/**
 * Reads the connected wallet address from an EIP-1193 injected provider
 * (MiniPay, or any browser wallet, for testing outside MiniPay).
 *
 * Ported directly from a reference Mini App confirmed working on a
 * physical MiniPay device (same wallet, same $3.91 USDT balance verified
 * on-screen in both apps): a single raw `eth_requestAccounts` call via
 * `.request()`, nothing else. Earlier attempts at this file layered viem's
 * `getAddresses()` (eth_accounts) and a legacy `enable()` fallback on top
 * of each other and were still intermittent — the proven-working
 * reference does none of that, just this one call.
 */
export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  enable?: () => Promise<unknown>;
};

export async function getWalletAddress(
  ethereum: EthereumProvider | undefined,
): Promise<string | null> {
  if (!ethereum) return null;
  try {
    const accounts = await ethereum.request({ method: "eth_requestAccounts" });
    if (Array.isArray(accounts) && accounts.length > 0) {
      return accounts[0] as string;
    }
    return null;
  } catch {
    return null;
  }
}
