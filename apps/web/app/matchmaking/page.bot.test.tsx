// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventEmitter } from "node:events";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(""), // defaults to CASUAL
}));

class FakeSocket extends EventEmitter {
  connected = true;
  connect = vi.fn();
}
const fakeSocket = new FakeSocket();
vi.mock("../../lib/socketSingleton", () => ({
  getSocket: () => fakeSocket,
}));

vi.mock("../../lib/useServerLedger", () => ({
  useServerLedger: () => ({
    loading: false,
    balance: 0,
    error: undefined,
    refresh: vi.fn().mockResolvedValue(0),
  }),
}));

vi.mock("../../lib/wallet", () => ({
  getWalletAddress: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../lib/waitForEthereum", () => ({
  waitForEthereum: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/serverUrl", () => ({
  getArenaTreasuryAddress: () => "0x1111111111111111111111111111111111111111",
  getDepositUrl: () => "https://example.test/api/deposit",
}));

import MatchmakingPage from "./page";

describe("MatchmakingScreen — Play vs Computer (CASUAL)", () => {
  beforeEach(() => {
    fakeSocket.removeAllListeners();
    push.mockClear();
  });

  it("shows a 'Play vs Computer' button in CASUAL mode", () => {
    render(<MatchmakingPage />);
    expect(screen.getByText("Play vs Computer")).toBeInTheDocument();
  });

  it("emits play_vs_bot and shows the searching state when tapped", () => {
    render(<MatchmakingPage />);
    const emitSpy = vi.spyOn(fakeSocket, "emit");

    fireEvent.click(screen.getByText("Play vs Computer"));

    expect(emitSpy).toHaveBeenCalledWith("play_vs_bot");
    expect(screen.getByText(/Searching for opponent/i)).toBeInTheDocument();
  });

  it("navigates to the game screen on match_found, same as a normal match", () => {
    render(<MatchmakingPage />);
    fireEvent.click(screen.getByText("Play vs Computer"));

    fakeSocket.emit("match_found", { matchId: "m1", color: "P1", opponent: "BOT" });

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("/game/m1?color=P1&opponent=BOT"),
    );
  });
});
