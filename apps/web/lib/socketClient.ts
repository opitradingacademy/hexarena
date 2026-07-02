import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@hexarena/shared/protocol";

export type HexArenaSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type SocketAuthProvider = () => { walletAddress?: string };

/**
 * Typed Socket.IO client for the realtime-protocol contract
 * (packages/shared/protocol). `autoConnect: false` so screens control the
 * connection lifecycle explicitly (e.g. only connect once entering
 * matchmaking). Server is sole authority — this client only sends intent
 * and reacts to server-broadcast state.
 *
 * `auth`, when provided, is re-evaluated by socket.io-client on every
 * connection attempt (including reconnects), so a wallet address resolved
 * after the socket was created is still picked up. socket.io-client's
 * dynamic-auth API requires a CALLBACK-style function (`(cb) => cb(data)`),
 * NOT a function that returns the data directly — passing the latter makes
 * the client wait forever for a callback invocation that never comes,
 * silently hanging before the Socket.IO connect packet is ever sent (the
 * underlying WebSocket still opens, which made this easy to miss). We wrap
 * the plain `() => data` provider into the callback shape socket.io expects.
 */
export function createSocketClient(
  serverUrl: string,
  auth?: SocketAuthProvider,
): HexArenaSocket {
  return io(serverUrl, {
    transports: ["websocket"],
    autoConnect: false,
    ...(auth ? { auth: (cb: (data: ReturnType<SocketAuthProvider>) => void) => cb(auth()) } : {}),
  }) as HexArenaSocket;
}
