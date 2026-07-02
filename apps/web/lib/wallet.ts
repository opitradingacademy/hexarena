import { createWalletClient, custom } from "viem";
import { celo } from "viem/chains";

/**
 * Reads the connected wallet address from an EIP-1193 injected provider
 * (MiniPay, or any browser wallet, for testing outside MiniPay).
 *
 * Tries three paths, in order:
 *  1. Silent `eth_accounts` (via viem's `getAddresses()`) — already
 *     authorized accounts, no prompt. Documented MiniPay pattern
 *     (celopedia-skill minipay-guide.md "Wallet Connection").
 *  2. `eth_requestAccounts` via `.request()` — the standard EIP-1193
 *     prompting call.
 *  3. Legacy `ethereum.enable()` — pre-EIP-1193 API. Confirmed by device
 *     testing that MiniPay's injected provider (at least inside its
 *     Developer Mode "Load Test Page" preview) answers `enable()`
 *     correctly while both `.request()`-based calls above silently return
 *     no accounts. `enable()` is deprecated for general dapps but MiniPay
 *     still implements it, so it is kept as the deciding fallback rather
 *     than the primary path (the `.request()` paths are still correct
 *     per spec and expected to work for a Mini App loaded normally, e.g.
 *     once listed, rather than through the raw test-page loader).
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
    const client = createWalletClient({ chain: celo, transport: custom(ethereum) });
    const accounts = await client.getAddresses();
    if (accounts[0]) return accounts[0];
  } catch {
    // fall through
  }

  try {
    const requested = await ethereum.request({ method: "eth_requestAccounts" });
    if (Array.isArray(requested) && requested.length > 0) {
      return requested[0] as string;
    }
  } catch {
    // fall through
  }

  if (typeof ethereum.enable === "function") {
    try {
      const enabled = await ethereum.enable();
      if (Array.isArray(enabled) && enabled.length > 0) {
        return enabled[0] as string;
      }
    } catch {
      return null;
    }
  }

  return null;
}
