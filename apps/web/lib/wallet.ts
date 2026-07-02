/**
 * Reads the connected wallet address from an EIP-1193 injected provider
 * (MiniPay, or any browser wallet, for testing outside MiniPay).
 */
export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export async function getWalletAddress(
  ethereum: EthereumProvider | undefined,
): Promise<string | null> {
  if (!ethereum) return null;
  try {
    const accounts = await ethereum.request({ method: "eth_requestAccounts" });
    if (!Array.isArray(accounts) || accounts.length === 0) return null;
    return accounts[0] as string;
  } catch {
    return null;
  }
}
