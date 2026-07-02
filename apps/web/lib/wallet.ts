import { createWalletClient, custom } from "viem";
import { celo } from "viem/chains";

/**
 * Reads the connected wallet address from an EIP-1193 injected provider
 * (MiniPay, or any browser wallet, for testing outside MiniPay).
 *
 * Uses viem's `createWalletClient({ transport: custom(ethereum) }).getAddresses()`
 * — the pattern documented for MiniPay (see celopedia-skill minipay-guide.md
 * "Wallet Connection" > "Without Any Library"). This resolves to an
 * `eth_accounts` call, NOT `eth_requestAccounts`: MiniPay auto-connects Mini
 * Apps (no permission prompt, no connect button), so the already-authorized
 * account is expected to come back immediately. A raw `eth_requestAccounts`
 * call — what this file did before — is the manual-connect flow regular
 * browser wallets (MetaMask, etc.) expect, and appears to silently return no
 * accounts in MiniPay's own "Mini App Test" preview tool instead of
 * triggering the auto-connect path.
 */
export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export async function getWalletAddress(
  ethereum: EthereumProvider | undefined,
): Promise<string | null> {
  if (!ethereum) return null;
  try {
    const client = createWalletClient({ chain: celo, transport: custom(ethereum) });
    const accounts = await client.getAddresses();
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}
