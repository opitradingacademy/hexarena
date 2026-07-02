"use client";

import { useEffect, useState } from "react";
import { isMiniPay, type MiniPayEthereumProvider } from "./isMiniPay";
import { waitForEthereum } from "./waitForEthereum";

declare global {
  interface Window {
    ethereum?: MiniPayEthereumProvider & {
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

/**
 * React hook wrapper around the pure `isMiniPay` detector.
 *
 * The original implementation returned `false` on first render (the
 * initial useState value) and only updated inside a `useEffect`, which
 * caused consumer components to read `false` during mount-time checks
 * (e.g. the Dashboard's `useEffect` read the captured value before the
 * state had time to flip). On physical MiniPay that translated into
 * the wrong MiniPay flag being recorded in the diagnostic panel even
 * though `window.ethereum.isMiniPay` was actually `true`.
 *
 * The fix: don't try to keep a useState mirror at all. The `isMiniPay`
 * check is cheap and synchronous once `waitForEthereum` has resolved,
 * and the value can change at runtime (account switch, MiniPay
 * development toggle). We re-read on every render after `waitForEthereum`
 * resolves, AND subscribe to `accountsChanged` so the consumer re-renders
 * if the provider flips its identity. Falls back to `false` during SSR.
 */
export function useIsMiniPay(): boolean {
  const [, setTick] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    waitForEthereum().then(() => {
      if (cancelled) return;
      setReady(true);
      // Try to refresh on account changes if MiniPay exposes the event.
      const handler = () => setTick((t) => t + 1);
      try {
        window.ethereum?.on?.("accountsChanged", handler);
      } catch {
        // ignore — some providers throw on unknown events
      }
    });
    return () => {
      cancelled = true;
      const handler = () => setTick((t) => t + 1);
      try {
        window.ethereum?.removeListener?.("accountsChanged", handler);
      } catch {
        // ignore
      }
    };
  }, []);

  if (!ready || typeof window === "undefined") return false;
  return isMiniPay(window.ethereum);
}
