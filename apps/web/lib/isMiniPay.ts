/**
 * MiniPay environment detection — spec "MiniPay Environment Detection".
 * Pure function: takes an injected provider (or undefined) and returns whether
 * it is the MiniPay in-app browser wallet.
 */
export type MiniPayEthereumProvider = {
  isMiniPay?: boolean;
  request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  enable?: () => Promise<unknown>;
};

export function isMiniPay(ethereum: MiniPayEthereumProvider | undefined): boolean {
  return ethereum?.isMiniPay === true;
}
