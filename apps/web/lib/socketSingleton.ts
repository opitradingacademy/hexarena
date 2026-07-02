import { createSocketClient, type HexArenaSocket } from "./socketClient";
import { getServerUrl } from "./serverUrl";
import { getWalletAddress } from "./wallet";

let socket: HexArenaSocket | null = null;
let walletAddress: string | undefined;

// Resolved best-effort at module load; `auth` below re-reads it on every
// connection attempt, so a late-resolving wallet is still picked up. When
// no provider is injected (plain browser, no MiniPay), walletAddress stays
// undefined and the server falls back to socket.id.
if (typeof window !== "undefined" && typeof window.ethereum?.request === "function") {
  getWalletAddress({ request: window.ethereum.request })
    .then((address) => {
      walletAddress = address ?? undefined;
    })
    .catch(() => {});
}

/**
 * Module-level singleton — screens navigate (matchmaking -> game -> history)
 * without losing the live connection, since Next.js unmounts each page's
 * component tree on route change.
 */
export function getSocket(): HexArenaSocket {
  if (!socket) {
    socket = createSocketClient(getServerUrl(), () => ({ walletAddress }));
  }
  return socket;
}
