"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { waitForEthereum } from "./waitForEthereum";
import { getWalletAddress } from "./wallet";
import { getUsdtBalance } from "./balance";

/**
 * Reads the user's USDT balance on Celo Mainnet from the live injected
 * MiniPay/provider. Used wherever the UI needs to know whether the
 * wallet has funds (Dashboard, Matchmaking, future Result/History).
 *
 * Returns a stable shape that's safe to consume in rendering code:
 *   { loading: bool, balance: number (USD), error?: Error, reload(): void }
 *
 * Routing through the injected provider (raw eth_call) instead of an
 * HTTP RPC is mandatory inside the MiniPay WebView — forno.celo.org
 * is blocked by CORS. See PR history (commit 6f9ebb9) for the full
 * trace that uncovered this.
 *
 * The hook owns its own cancellation token so navigating between
 * screens mid-load doesn't apply a stale balance to the next view.
 */
export type UseUsdtBalanceResult = {
  loading: boolean;
  balance: number;
  error?: Error;
  reload: () => void;
};

export function useUsdtBalance(): UseUsdtBalanceResult {
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>();
  const [tick, setTick] = useState(0);
  const cancelledRef = useRef(false);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    setError(undefined);

    (async () => {
      try {
        await waitForEthereum();
        if (cancelledRef.current) return;
        const ethereum = window.ethereum as
          | (Parameters<typeof getWalletAddress>[0] & {
              request: (...args: unknown[]) => Promise<unknown>;
            })
          | undefined;
        if (!ethereum?.request) {
          // No provider available at all — wallet-less environment.
          setBalance(0);
          setLoading(false);
          return;
        }
        const walletAddress = await getWalletAddress(ethereum, {
          retries: 6,
          delayMs: 500,
        });
        if (cancelledRef.current) return;
        if (!walletAddress) {
          setBalance(0);
          setLoading(false);
          return;
        }
        const requestFn = ethereum.request.bind(ethereum) as Parameters<
          typeof getUsdtBalance
        >[1]["request"];
        const next = await getUsdtBalance(walletAddress, { request: requestFn });
        if (cancelledRef.current) return;
        setBalance(next ?? 0);
        setLoading(false);
      } catch (e) {
        if (cancelledRef.current) return;
        setError(e as Error);
        setBalance(0);
        setLoading(false);
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [tick]);

  return { loading, balance, error, reload };
}
