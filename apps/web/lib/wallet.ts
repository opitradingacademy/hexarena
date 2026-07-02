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
 *
 * On physical MiniPay WebView, the first `eth_requestAccounts` call
 * occasionally returns `[]` for ~250-750 ms after page mount while the
 * wallet session hydrates inside the WebView. We retry with a short
 * delay when the call succeeds (no throw) but returns an empty array —
 * defaulting to 3 retries × 250ms (1 s total), enough to outlast the
 * hydration window without making desktop callers (MetaMask et al.)
 * block noticeably. Pass `{ retries: 0 }` for the fast-path.
 */
export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  enable?: () => Promise<unknown>;
};

export type GetWalletAddressOptions = {
  /** Number of retries after the first call when the result is []. Default: 3. */
  retries?: number;
  /** Delay between retries in ms. Default: 250. */
  delayMs?: number;
};

export async function getWalletAddress(
  ethereum: EthereumProvider | undefined,
  options: GetWalletAddressOptions = {},
): Promise<string | null> {
  if (!ethereum) return null;
  const retries = options.retries ?? 3;
  const delayMs = options.delayMs ?? 250;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      if (Array.isArray(accounts) && accounts.length > 0) {
        return accounts[0] as string;
      }
      // Empty array — wallet says "no accounts yet". Only retry when
      // the caller asked for retries AND we still have attempts left.
      if (attempt < retries) {
        await sleep(delayMs);
        continue;
      }
      return null;
    } catch {
      // Provider rejected — don't retry; respect the user's denial.
      return null;
    }
  }
  return null;
}
