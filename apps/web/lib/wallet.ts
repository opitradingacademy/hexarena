/**
 * Reads the connected wallet address from an EIP-1193 injected provider
 * (MiniPay, or any browser wallet, for testing outside MiniPay).
 *
 * On physical MiniPay WebView, the first `eth_requestAccounts` call
 * occasionally returns `[]` for ~250-750 ms after page mount while the
 * wallet session hydrates inside the WebView. We retry with a short
 * delay when the call succeeds (no throw) but returns an empty array —
 * defaulting to 3 retries × 250ms (1 s total), enough to outlast the
 * hydration window without making desktop callers (MetaMask et al.)
 * block noticeably. Pass `{ retries: 0 }` for the fast-path.
 *
 * For diagnostics on a physical device (no DevTools available there),
 * the retry loop exposes per-attempt breadcrumbs via an onTrace callback.
 * Each trace line includes the attempt index, elapsed ms, the literal
 * shape of the response (array length, string, null, thrown error),
 * and — for each attempt that touches the provider — the in-flight
 * presence of `selectedAddress`, `_state`, and `isConnected` flags.
 */
export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  enable?: () => Promise<unknown>;
  // optional — present on MetaMask and some MiniPay builds
  selectedAddress?: string;
  isConnected?: boolean;
};

export type GetWalletAddressOptions = {
  /** Number of retries after the first call when the result is []. Default: 3. */
  retries?: number;
  /** Delay between retries in ms. Default: 250. */
  delayMs?: number;
  /**
   * Per-attempt breadcrumb sink. Captures: attempt number, elapsed
   * milliseconds, shape of the response (kind/length/error), and the
   * state of the provider after each request returns. Use only for
   * diagnostics — never block on the listener.
   */
  onTrace?: (entry: WalletTrace) => void;
};

export type WalletTrace = {
  attempt: number;
  elapsedMs: number;
  resultKind: "array-empty" | "array-with" | "string" | "null" | "throw";
  resultLen?: number;
  selectedAddress?: string;
  enableExists?: boolean;
  errMessage?: string;
};

function describeResult(value: unknown): Pick<WalletTrace, "resultKind" | "resultLen"> {
  if (value === null) return { resultKind: "null" };
  if (Array.isArray(value)) {
    return {
      resultKind: value.length === 0 ? "array-empty" : "array-with",
      resultLen: value.length,
    };
  }
  if (typeof value === "string") return { resultKind: "string", resultLen: value.length };
  return { resultKind: "string" };
}

export async function getWalletAddress(
  ethereum: EthereumProvider | undefined,
  options: GetWalletAddressOptions = {},
): Promise<string | null> {
  if (!ethereum) return null;
  const retries = options.retries ?? 3;
  const delayMs = options.delayMs ?? 250;
  const onTrace = options.onTrace;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  for (let attempt = 0; attempt <= retries; attempt++) {
    const start = Date.now();
    try {
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      const elapsed = Date.now() - start;
      const { resultKind, resultLen } = describeResult(accounts);
      onTrace?.({
        attempt,
        elapsedMs: elapsed,
        resultKind,
        resultLen,
        selectedAddress: ethereum.selectedAddress,
        enableExists: typeof ethereum.enable === "function",
      });
      if (Array.isArray(accounts) && accounts.length > 0) {
        return accounts[0] as string;
      }
      if (attempt < retries) {
        await sleep(delayMs);
        continue;
      }
      return null;
    } catch (e) {
      const elapsed = Date.now() - start;
      onTrace?.({
        attempt,
        elapsedMs: elapsed,
        resultKind: "throw",
        errMessage: (e as Error).message,
        selectedAddress: ethereum.selectedAddress,
        enableExists: typeof ethereum.enable === "function",
      });
      return null;
    }
  }
  return null;
}
