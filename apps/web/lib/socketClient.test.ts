import { describe, expect, it, vi } from "vitest";

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({ connected: false, on: vi.fn(), emit: vi.fn() })),
}));

import { io } from "socket.io-client";
import { createSocketClient } from "./socketClient";

describe("createSocketClient", () => {
  it("connects to the given server URL with websocket transport", () => {
    createSocketClient("https://api.hexarena.example");
    expect(io).toHaveBeenCalledWith(
      "https://api.hexarena.example",
      expect.objectContaining({ transports: ["websocket"] }),
    );
  });

  it("does not autoConnect eagerly so callers control connection lifecycle", () => {
    createSocketClient("https://api.hexarena.example");
    expect(io).toHaveBeenCalledWith(
      "https://api.hexarena.example",
      expect.objectContaining({ autoConnect: false }),
    );
  });
});
