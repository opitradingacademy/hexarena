/**
 * MiniPay (and most injected-wallet browsers) inject `window.ethereum`
 * asynchronously, AFTER the page's own scripts may have already started
 * running — reading `window.ethereum` synchronously on mount can race the
 * injection and see `undefined`, or a not-yet-ready provider. Providers
 * that follow this convention fire an `ethereum#initialized` window event
 * once injection completes.
 *
 * Confirmed via a working reference Mini App on the same physical device:
 * without this wait, wallet reads intermittently failed with zero
 * accounts and no error (the classic symptom of this exact race).
 */
export function waitForEthereum(timeoutMs = 3000): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.ethereum) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("ethereum#initialized", onInit);
      resolve(false);
    }, timeoutMs);

    function onInit() {
      clearTimeout(timer);
      resolve(true);
    }

    window.addEventListener("ethereum#initialized", onInit, { once: true });
  });
}
