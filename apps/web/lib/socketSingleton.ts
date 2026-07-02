import { createSocketClient, type HexArenaSocket } from "./socketClient";
import { getServerUrl } from "./serverUrl";

let socket: HexArenaSocket | null = null;

/**
 * Module-level singleton — screens navigate (matchmaking -> game -> history)
 * without losing the live connection, since Next.js unmounts each page's
 * component tree on route change.
 */
export function getSocket(): HexArenaSocket {
  if (!socket) {
    socket = createSocketClient(getServerUrl());
  }
  return socket;
}
