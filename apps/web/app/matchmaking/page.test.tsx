// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EventEmitter } from "node:events";

const push = vi.fn();
type LedgerMock = { balance: number; refresh: () => Promise<number> };
let ledgerState: LedgerMock = {
  balance: 0,
  refresh: vi.fn().mockResolvedValue(0),
};
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("mode=arena"),
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
    balance: ledgerState.balance,
    error: undefined,
    refresh: ledgerState.refresh,
  }),
}));

vi.mock("../../lib/wallet", () => ({
  getWalletAddress: vi.fn().mockResolvedValue("0x2222222222222222222222222222222222222222"),
}));

vi.mock("../../lib/waitForEthereum", () => ({
  waitForEthereum: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/serverUrl", () => ({
  getArenaTreasuryAddress: () => "0x1111111111111111111111111111111111111111",
  getDepositUrl: () => "https://example.test/api/deposit",
}));

import MatchmakingPage from "./page";

describe("MatchmakingScreen — Arena stake balance reuse", () => {
  beforeEach(() => {
    fakeSocket.removeAllListeners();
    push.mockClear();
    ledgerState = {
      balance: 3.69,
      refresh: vi.fn().mockResolvedValue(3.69),
    };
  });

  it("emits join_queue directly without forcing a fresh deposit when the ledger already has enough balance", async () => {
    render(<MatchmakingPage />);

    fireEvent.click(screen.getByText("$0.10"));
    const emitSpy = vi.spyOn(fakeSocket, "emit");
    fireEvent.click(screen.getByText("Find match"));

    expect(emitSpy).toHaveBeenCalledWith("join_queue", { mode: "ARENA", stake: 0.1 });
    expect(screen.queryByTestId("stake-confirm-dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Searching for opponent/i)).toBeInTheDocument());
  });

  it("opens the deposit dialog when the server rejects INSUFFICIENT_BALANCE mid-flight and the ledger still shows 0 after reload", async () => {
    // Production 2026-07-03 modal-loop path: user has the chip
    // enabled (server ledger showed enough at mount), picks $0.10,
    // taps Find match, server rejects with INSUFFICIENT_BALANCE.
    // The new code refreshes the ledger first; if the refresh
    // returns 0 (i.e. the server-side view truly doesn't cover the
    // stake), the dialog opens.
    ledgerState = {
      balance: 3.69,
      refresh: vi.fn().mockResolvedValue(0),
    };
    render(<MatchmakingPage />);

    fireEvent.click(screen.getByText("$0.10"));
    const emitSpy = vi.spyOn(fakeSocket, "emit");
    fireEvent.click(screen.getByText("Find match"));
    await waitFor(() => expect(screen.getByText(/Searching for opponent/i)).toBeInTheDocument());
    emitSpy.mockClear();

    fakeSocket.emit("error", { code: "INSUFFICIENT_BALANCE", msg: "Insufficient balance" });

    await waitFor(() => expect(screen.getByTestId("stake-confirm-dialog")).toBeInTheDocument());
    expect(emitSpy).not.toHaveBeenCalledWith(
      "join_queue",
      expect.objectContaining({ mode: "ARENA" }),
    );
  });

  it("does NOT open the deposit dialog if the server ledger reload shows enough — retries join_queue", async () => {
    // Production 2026-07-03 modal-loop fix cover: server rejects
    // with INSUFFICIENT_BALANCE based on stale state, but the
    // actual server ledger (refreshed) DOES cover the stake. The
    // screen must re-emit join_queue silently and never pop the
    // modal — otherwise the user signs another tx they didn't
    // need to.
    const refreshSpy = vi.fn().mockResolvedValue(0.5);
    ledgerState = { balance: 3.69, refresh: refreshSpy };
    render(<MatchmakingPage />);

    fireEvent.click(screen.getByText("$0.10"));
    const emitSpy = vi.spyOn(fakeSocket, "emit");
    fireEvent.click(screen.getByText("Find match"));
    await waitFor(() => expect(screen.getByText(/Searching for opponent/i)).toBeInTheDocument());
    emitSpy.mockClear();

    fakeSocket.emit("error", { code: "INSUFFICIENT_BALANCE", msg: "stale cache" });

    await waitFor(() =>
      expect(emitSpy).toHaveBeenCalledWith("join_queue", { mode: "ARENA", stake: 0.1 }),
    );
    expect(screen.queryByTestId("stake-confirm-dialog")).not.toBeInTheDocument();
    expect(refreshSpy).toHaveBeenCalled();
  });
});
