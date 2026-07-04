// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { EventEmitter } from "node:events";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ code: "abc12345" }),
  useRouter: () => ({ push }),
}));

class FakeSocket extends EventEmitter {
  connected = true;
  connect = vi.fn();
}
const fakeSocket = new FakeSocket();
vi.mock("../../../lib/socketSingleton", () => ({
  getSocket: () => fakeSocket,
}));

import InvitePage from "./page";

describe("InvitePage", () => {
  beforeEach(() => {
    fakeSocket.removeAllListeners();
    push.mockClear();
  });

  it("emits join_invite with the code from the URL on mount", () => {
    const emitSpy = vi.spyOn(fakeSocket, "emit");
    render(<InvitePage />);
    expect(emitSpy).toHaveBeenCalledWith("join_invite", { code: "abc12345" });
  });

  it("navigates to the game screen on match_found", () => {
    render(<InvitePage />);
    fakeSocket.emit("match_found", { matchId: "m1", color: "P2", opponent: "0xHOST" });
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("/game/m1?color=P2&opponent=0xHOST"),
    );
  });

  it("shows an error message when the invite is invalid or expired", () => {
    render(<InvitePage />);
    act(() => {
      fakeSocket.emit("error", { code: "NOT_FOUND", msg: "gone" });
    });
    expect(screen.getByRole("alert").textContent).toMatch(/no longer valid/i);
  });

  it("shows a balance-specific error message when the joiner can't cover the stake", () => {
    render(<InvitePage />);
    act(() => {
      fakeSocket.emit("error", { code: "INSUFFICIENT_BALANCE", msg: "nope" });
    });
    expect(screen.getByRole("alert").textContent).toMatch(/enough balance/i);
  });
});
