import { describe, expect, it, vi } from "vitest";

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({ connected: false, on: vi.fn(), emit: vi.fn(), connect: vi.fn() })),
}));

import { io } from "socket.io-client";
import { getSocket } from "./socketSingleton";

describe("getSocket", () => {
  it("reuses the same socket instance across calls (survives page navigation)", () => {
    const a = getSocket();
    const b = getSocket();
    expect(a).toBe(b);
    expect(io).toHaveBeenCalledTimes(1);
  });
});
