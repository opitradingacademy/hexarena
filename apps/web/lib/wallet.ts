/**
 * Reads the connected wallet address from an EIP-1193 injected provider
 * (MiniPay, or any browser wallet, for testing outside MiniPay).
 *
 * Resolution order (each only attempted if the previous returned nothing):
 *   1. `provider.selectedAddress` if it's already a valid 0x address.
 *      No RPC, no permission prompt — the wallet has already authorised
 *      the session upstream and exposed the address for read.
 *   2. `eth_accounts` (EIP-1102/RPC). Also no prompt, but lists every
 *      address the session already controls. MetaMask et al. expose the
 *      current selection here.
 *   3. `eth_requestAccounts`. The only call that pops a connect dialog.
 *      Retried with a short delay when it returns `[]`, because MiniPay's
 *      provider-stub occasionally returns [] for ~250-750 ms while the
 *      WebView session hydrates before yielding addresses.
 *
 * This fallback order matches what `wagmi`'s `useAccount()` does
 * internally. It's also the canonical pattern recommended by the
 * proven-working reference Mini App plus the docs.minipay.xyz
 * Wallet Connection guide.
 *
 * Why the chain matters: the MiniPay dev-mode WebView provider-stub has
 * an internal bug (`this._request is not a function`) that makes
 * `eth_requestAccounts` throw — but `selectedAddress` is populated
 * correctly, so step 1 saves us. On production wallets (MetaMask on
 * desktop, production-mode MiniPay browser) the order still does the
 * right thing: step 1 wins if connected, step 2 wins if the dapp was
 * already authorised in a prior session, step 3 is the cold-start path.
 */
export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  enable?: () => Promise<unknown>;
  // optional — present on MetaMask and some MiniPay builds
  selectedAddress?: string;
  isConnected?: boolean;
};

export type GetWalletAddressOptions = {
  /** Number of retries on step 3 when the call returns []. Default: 3. */
  retries?: number;
  /** Delay between retries in ms (step 3 only). Default: 250. */
  delayMs?: number;
  /** Per-attempt breadcrumb sink for diagnostics. */
  onTrace?: (entry: WalletTrace) => void;
};

export type WalletTrace = {
  step: "selectedAddress" | "eth_accounts" | "eth_requestAccounts";
  attempt: number;
  elapsedMs: number;
  resultKind: "array-empty" | "array-with" | "string" | "null" | "throw";
  resultLen?: number;
  selectedAddress?: string;
  errMessage?: string;
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function isAddressLike(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

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

function extractFirstAddress(value: unknown): string | null {
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (isAddressLike(first)) return first;
  }
  return null;
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

  // STEP 1: provider.selectedAddress. Free — no RPC, no permission.
  if (isAddressLike(ethereum.selectedAddress)) {
    onTrace?.({
      step: "selectedAddress",
      attempt: 0,
      elapsedMs: 0,
      resultKind: "array-with",
      resultLen: 1,
      selectedAddress: ethereum.selectedAddress,
    });
    return ethereum.selectedAddress;
  }

  // STEP 2: eth_accounts. Lists already-authorised addresses, no prompt.
  if (typeof ethereum.request === "function") {
    const t0 = Date.now();
    try {
      const accounts = await ethereum.request({ method: "eth_accounts" });
      onTrace?.({
        step: "eth_accounts",
        attempt: 0,
        elapsedMs: Date.now() - t0,
        ...describeResult(accounts),
      });
      const addr = extractFirstAddress(accounts);
      if (addr) return addr;
    } catch (e) {
      onTrace?.({
        step: "eth_accounts",
        attempt: 0,
        elapsedMs: Date.now() - t0,
        resultKind: "throw",
        errMessage: (e as Error).message,
      });
      // continue to step 3
    }
  }

  // STEP 3: eth_requestAccounts. The only call that pops a connect dialog.
  // Retry on [] because some MiniPay builds hydrate the wallet session a
  // short while after the WebView loads (250-750 ms typically).
  if (typeof ethereum.request !== "function") return null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const start = Date.now();
    try {
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      const elapsed = Date.now() - start;
      onTrace?.({
        step: "eth_requestAccounts",
        attempt,
        elapsedMs: elapsed,
        ...describeResult(accounts),
      });
      const addr = extractFirstAddress(accounts);
      if (addr) return addr;
      if (attempt < retries) {
        await sleep(delayMs);
        continue;
      }
      return null;
    } catch (e) {
      onTrace?.({
        step: "eth_requestAccounts",
        attempt,
        elapsedMs: Date.now() - start,
        resultKind: "throw",
        errMessage: (e as Error).message,
      });
      return null;
    }
  }
  return null;
}
