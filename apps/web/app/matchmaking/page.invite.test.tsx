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

  it("shows the invite code (and a discreet web link) once invite_created arrives", () => {
    render(<MatchmakingPage />);
    fireEvent.click(screen.getByText("Invite a friend"));

    act(() => {
      fakeSocket.emit("invite_created", { code: "abc12345", expiresAt: Date.now() + 300_000 });
    });

    expect(screen.getByTestId("invite-code").textContent).toBe("abc12345");
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

describe("MatchmakingScreen — Join with a code", () => {
  beforeEach(() => {
    fakeSocket.removeAllListeners();
    push.mockClear();
  });

  it("emits join_invite with the typed code", () => {
    render(<MatchmakingPage />);
    const emitSpy = vi.spyOn(fakeSocket, "emit");

    fireEvent.change(screen.getByPlaceholderText("Enter a code"), {
      target: { value: "xyz98765" },
    });
    fireEvent.click(screen.getByText("Join"));

    expect(emitSpy).toHaveBeenCalledWith("join_invite", { code: "xyz98765" });
  });

  it("disables the Join button until a code is typed", () => {
    render(<MatchmakingPage />);
    expect(screen.getByText("Join")).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("Enter a code"), {
      target: { value: "xyz98765" },
    });

    expect(screen.getByText("Join")).not.toBeDisabled();
  });

  it("navigates to the game screen once join_invite pairs with the host", () => {
    render(<MatchmakingPage />);
    fireEvent.change(screen.getByPlaceholderText("Enter a code"), {
      target: { value: "xyz98765" },
    });
    fireEvent.click(screen.getByText("Join"));

    fakeSocket.emit("match_found", { matchId: "m2", color: "P2", opponent: "0xHOST" });

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("/game/m2?color=P2&opponent=0xHOST"),
    );
  });

  it("shows a friendly message when the code is invalid", () => {
    render(<MatchmakingPage />);
    fireEvent.change(screen.getByPlaceholderText("Enter a code"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByText("Join"));

    act(() => {
      fakeSocket.emit("error", { code: "NOT_FOUND", msg: "gone" });
    });

    expect(screen.getByRole("alert").textContent).toMatch(/code isn't valid/i);
  });
});
