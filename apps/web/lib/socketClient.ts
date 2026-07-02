import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@hexarena/shared/protocol";

export type HexArenaSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Typed Socket.IO client for the realtime-protocol contract
 * (packages/shared/protocol). `autoConnect: false` so screens control the
 * connection lifecycle explicitly (e.g. only connect once entering
 * matchmaking). Server is sole authority — this client only sends intent
 * and reacts to server-broadcast state.
 */
export function createSocketClient(serverUrl: string): HexArenaSocket {
  return io(serverUrl, {
    transports: ["websocket"],
    autoConnect: false,
  }) as HexArenaSocket;
}
