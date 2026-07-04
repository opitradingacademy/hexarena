// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventEmitter } from "node:events";

let searchParams = new URLSearchParams("color=P1&opponent=BOT");
vi.mock("next/navigation", () => ({
  useParams: () => ({ matchId: "m1" }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

class FakeSocket extends EventEmitter {
  connected = true;
  connect = vi.fn();
}
const fakeSocket = new FakeSocket();
vi.mock("../../../lib/socketSingleton", () => ({
  getSocket: () => fakeSocket,
}));

import GamePage from "./page";

describe("GamePage — bot opponent label", () => {
  beforeEach(() => {
    fakeSocket.removeAllListeners();
  });

  it("shows 'HexArena Bot' when the opponent is the local bot", () => {
    searchParams = new URLSearchParams("color=P1&opponent=BOT");
    render(<GamePage />);
    expect(screen.getByText("HexArena Bot")).toBeInTheDocument();
  });

  it("shows a truncated address label for a real human opponent", () => {
    searchParams = new URLSearchParams(
      "color=P1&opponent=0x2222222222222222222222222222222222222222",
    );
    render(<GamePage />);
    expect(screen.getByText("Opponent #0X22")).toBeInTheDocument();
  });
});
