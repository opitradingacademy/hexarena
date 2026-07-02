"use client";

import { useEffect, useState } from "react";
import { isMiniPay, type MiniPayEthereumProvider } from "./isMiniPay";

declare global {
  interface Window {
    ethereum?: MiniPayEthereumProvider;
  }
}

/**
 * React hook wrapper around the pure `isMiniPay` detector.
 * Returns `false` during SSR/first paint, then resolves on mount once
 * `window.ethereum` is available (spec "MiniPay Environment Detection").
 */
export function useIsMiniPay(): boolean {
  const [miniPay, setMiniPay] = useState(false);

  useEffect(() => {
    setMiniPay(isMiniPay(window.ethereum));
  }, []);

  return miniPay;
}
