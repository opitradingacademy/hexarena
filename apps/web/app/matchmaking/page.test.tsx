// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EventEmitter } from "node:events";

const push = vi.fn();
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

vi.mock("../../lib/useUsdtBalance", () => ({
  useUsdtBalance: () => ({ loading: false, balance: 3.69, reload: vi.fn() }),
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
  });

  it("emits join_queue directly instead of forcing a fresh deposit when the ledger already has enough balance", async () => {
    render(<MatchmakingPage />);

    fireEvent.click(screen.getByText("$0.10"));
    const emitSpy = vi.spyOn(fakeSocket, "emit");
    fireEvent.click(screen.getByText("Find match"));

    expect(emitSpy).toHaveBeenCalledWith("join_queue", { mode: "ARENA", stake: 0.1 });
    expect(screen.queryByTestId("stake-confirm-dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/Searching for opponent/i)).toBeInTheDocument(),
    );
  });

  it("opens the deposit dialog only after the server rejects with INSUFFICIENT_BALANCE", async () => {
    render(<MatchmakingPage />);

    fireEvent.click(screen.getByText("$0.10"));
    fireEvent.click(screen.getByText("Find match"));
    await waitFor(() =>
      expect(screen.getByText(/Searching for opponent/i)).toBeInTheDocument(),
    );

    fakeSocket.emit("error", { code: "INSUFFICIENT_BALANCE", msg: "Insufficient balance" });

    await waitFor(() =>
      expect(screen.getByTestId("stake-confirm-dialog")).toBeInTheDocument(),
    );
  });
});
