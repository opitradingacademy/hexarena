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

  it("forwards an auth function so the wallet address is re-evaluated on each connection attempt", () => {
    const auth = () => ({ walletAddress: "0xabc" });
    createSocketClient("https://api.hexarena.example", auth);
    expect(io).toHaveBeenCalledWith(
      "https://api.hexarena.example",
      expect.objectContaining({ auth }),
    );
  });

  it("omits auth when no auth function is provided", () => {
    createSocketClient("https://api.hexarena.example");
    const options = vi.mocked(io).mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(options).not.toHaveProperty("auth");
  });
});
