import { createSocketClient, type HexArenaSocket } from "./socketClient";
import { getServerUrl } from "./serverUrl";
import { getWalletAddress } from "./wallet";
import { waitForEthereum } from "./waitForEthereum";

let socket: HexArenaSocket | null = null;

/**
 * Module-level singleton — screens navigate (matchmaking -> game -> history)
 * without losing the live connection, since Next.js unmounts each page's
 * component tree on route change.
 *
 * Production 2026-07-03 root cause of the modal-reopen loop: the auth
 * callback previously captured `walletAddress` at module load time, but
 * MiniPay injects `window.ethereum` asynchronously (after the
 * "ethereum#initialized" event). If the first read raced the
 * injection, the captured wallet stayed undefined for the lifetime of
 * the page — every socket reconnect sent no `walletAddress` in
 * `auth`, so the server fell back to a fresh `socket.id` per
 * reconnect, and the matchmaker's `balanceOf(store, userId)` check
 * evaluated a different userId than the one /api/deposit credited.
 *
 * Now: every `auth` invocation runs `waitForEthereum().then(readWallet)`
 * afresh. There's still a race — if MiniPay injects after the
 * callback returns, we'd miss this attempt — but socket.io calls
 * `auth` again on each reconnect, so the next attempt picks it up.
 */
export function getSocket(): HexArenaSocket {
  if (!socket) {
    socket = createSocketClient(getServerUrl(), async () => {
      try {
        // Production 2026-07-03: ensure MiniPay's window.ethereum is
        // injected (fire-and-forget — socket.io will retry on reconnect).
        await waitForEthereum();
        const address = await getWalletAddress(window.ethereum as never);
        return address ? { walletAddress: address } : {};
      } catch {
        return {};
      }
    });
  }
  return socket;
}
