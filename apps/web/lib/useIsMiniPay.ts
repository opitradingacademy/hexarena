"use client";

import { useEffect, useState } from "react";
import { isMiniPay, type MiniPayEthereumProvider } from "./isMiniPay";
import { waitForEthereum } from "./waitForEthereum";

declare global {
  interface Window {
    ethereum?: MiniPayEthereumProvider;
  }
}

/**
 * React hook wrapper around the pure `isMiniPay` detector.
 * Returns `false` during SSR/first paint, then resolves on mount once
 * `window.ethereum` is available (spec "MiniPay Environment Detection").
 * Waits for MiniPay's async injection first (see `waitForEthereum`) so a
 * provider that shows up a moment after mount isn't missed.
 */
export function useIsMiniPay(): boolean {
  const [miniPay, setMiniPay] = useState(false);

  useEffect(() => {
    let cancelled = false;
    waitForEthereum().then(() => {
      if (!cancelled) setMiniPay(isMiniPay(window.ethereum));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return miniPay;
}
