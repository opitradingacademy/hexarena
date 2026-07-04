// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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

Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

import MatchmakingPage from "./page";

describe("MatchmakingScreen — Invite a friend (CASUAL)", () => {
  beforeEach(() => {
    fakeSocket.removeAllListeners();
    push.mockClear();
  });

  it("emits create_invite when tapped", () => {
    render(<MatchmakingPage />);
    const emitSpy = vi.spyOn(fakeSocket, "emit");

    fireEvent.click(screen.getByText("Invite a friend"));

    expect(emitSpy).toHaveBeenCalledWith("create_invite", { mode: "CASUAL" });
  });

  it("shows the invite link once the server responds with invite_created", () => {
    render(<MatchmakingPage />);
    fireEvent.click(screen.getByText("Invite a friend"));

    act(() => {
      fakeSocket.emit("invite_created", { code: "abc12345", expiresAt: Date.now() + 300_000 });
    });

    expect(screen.getByTestId("invite-link").textContent).toContain("/invite/abc12345");
  });

  it("navigates to the game screen once the invited friend joins", () => {
    render(<MatchmakingPage />);
    fireEvent.click(screen.getByText("Invite a friend"));
    act(() => {
      fakeSocket.emit("invite_created", { code: "abc12345", expiresAt: Date.now() + 300_000 });
    });

    fakeSocket.emit("match_found", { matchId: "m1", color: "P1", opponent: "0xFRIEND" });

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("/game/m1?color=P1&opponent=0xFRIEND"),
    );
  });
});
