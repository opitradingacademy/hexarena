"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { waitForEthereum } from "./waitForEthereum";
import { getWalletAddress } from "./wallet";

/**
 * Reads the user's SERVER-side Arena ledger balance from `GET
 * /api/balance?wallet=<addr>`.
 *
 * Why this hook exists separately from `useUsdtBalance` (which reads
 * on-chain via eth_call):
 *
 * - `useUsdtBalance` shows the user's wallet balance. It's the right
 *   number for the Dashboard ("you have $X.30 in your wallet") but
 *   the WRONG number for the matchmaking flow, because the matchmaking
 *   server checks its OWN ledger (`store.balanceOf(userId)`), not the
 *   on-chain balance — see arena-deposit Approach B in CLAUDE.md.
 *
 * - If a user has 0.30 USDT in the wallet but only 0.10 has been
 *   polled by the server so far (because /api/deposit timed out the
 *   40s budget against the public RPCs), the matchmaking gate at
 *   "FIND MATCH" should reflect the 0.10 the server knows about —
 *   otherwise we open the deposit modal again for the other 0.20,
 *   causing the user to sign a fresh tx they didn't need to.
 *
 * - Conversely, the on-chain wallet may already be 0 after a withdraw
 *   or after the user already signed the deposit tx, while the server
 *   ledger still shows the credit. In that case we want the SERVER
 *   number so the modal doesn't open unnecessarily.
 *
 * Returns a stable shape so the matchmaking screen can refresh it
 * after every deposit / cancel / retry, and after every socket error
 * (`INSUFFICIENT_BALANCE`), to converge with the server's view.
 * `refresh()` is async and RESOLVES with the freshly-read balance
 * (so callers can ask "is the server-side balance enough to cover
 * stake X?" without stale-closure bugs from the React render cycle).
 */
export type UseServerLedgerResult = {
  loading: boolean;
  balance: number;
  error?: Error;
  refresh: () => Promise<number>;
};

async function readBalance(apiBaseUrl: string): Promise<number> {
  await waitForEthereum();
  const ethereum = window.ethereum as
    { request: (...args: unknown[]) => Promise<unknown> } | undefined;
  if (!ethereum?.request) return 0;
  const walletAddress = await getWalletAddress(ethereum, {
    retries: 6,
    delayMs: 500,
  });
  if (!walletAddress) return 0;
  const url = `${apiBaseUrl}/api/balance?wallet=${encodeURIComponent(walletAddress)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`server balance returned ${res.status} BAD_REQUEST`);
  const body = (await res.json()) as { balanceUSD: number };
  return body.balanceUSD ?? 0;
}

export function useServerLedger(apiBaseUrl: string): UseServerLedgerResult {
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>();
  const cancelledRef = useRef(false);

  const refresh = useCallback(async (): Promise<number> => {
    try {
      const next = await readBalance(apiBaseUrl);
      if (!cancelledRef.current) {
        setBalance(next);
        setError(undefined);
      }
      return next;
    } catch (e) {
      if (!cancelledRef.current) setError(e as Error);
      return 0;
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    setError(undefined);
    void refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  return { loading, balance, error, refresh };
}
