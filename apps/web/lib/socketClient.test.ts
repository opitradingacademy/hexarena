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

  it("wraps the auth provider in socket.io-client's callback-style auth contract", () => {
    // socket.io-client requires a function auth option to be CALLBACK-style
    // (`(cb) => cb(data)`) — a function that just returns data directly is
    // never invoked correctly by the client and hangs the connection before
    // the Socket.IO connect packet is ever sent. Regression test for that.
    const auth = () => ({ walletAddress: "0xabc" });
    createSocketClient("https://api.hexarena.example", auth);
    const options = vi.mocked(io).mock.calls.at(-1)?.[1] as { auth: unknown };
    expect(typeof options.auth).toBe("function");

    const cb = vi.fn();
    (options.auth as (cb: (data: unknown) => void) => void)(cb);
    expect(cb).toHaveBeenCalledWith({ walletAddress: "0xabc" });
  });

  it("re-evaluates the auth provider on each connection attempt", () => {
    let wallet = "0xabc";
    const auth = () => ({ walletAddress: wallet });
    createSocketClient("https://api.hexarena.example", auth);
    const options = vi.mocked(io).mock.calls.at(-1)?.[1] as { auth: unknown };

    wallet = "0xdef";
    const cb = vi.fn();
    (options.auth as (cb: (data: unknown) => void) => void)(cb);
    expect(cb).toHaveBeenCalledWith({ walletAddress: "0xdef" });
  });

  it("omits auth when no auth function is provided", () => {
    createSocketClient("https://api.hexarena.example");
    const options = vi.mocked(io).mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(options).not.toHaveProperty("auth");
  });
});
