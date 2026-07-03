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

function mockEthereumSuccess(txHash = "0x" + "ab".repeat(32)): void {
  Object.defineProperty(window, "ethereum", {
    value: {
      request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return "0xa4ec";
        if (method === "eth_blockNumber") return "0x1";
        if (method === "eth_requestAccounts") return ["0x2222222222222222222222222222222222222222"];
        if (method === "eth_accounts") return ["0x2222222222222222222222222222222222222222"];
        if (method === "eth_estimateGas") return "0x186a0";
        if (method === "eth_sendTransaction") return txHash;
        if (method === "eth_getTransactionReceipt") {
          return {
            status: "success",
            to: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
            from: "0x2222222222222222222222222222222222222222",
            logs: [
              {
                address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
                topics: [
                  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                  "0x0000000000000000000000002222222222222222222222222222222222222222",
                  "0x0000000000000000000000001111111111111111111111111111111111111111",
                ],
                data: "0x" + 100_000n.toString(16).padStart(64, "0"),
              },
            ],
          };
        }
        throw new Error("unreachable: " + method);
      }),
    },
    configurable: true,
    writable: true,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, balanceUSD: 0.1 }),
    }),
  );
}

describe("MatchmakingScreen — Arena stake balance reuse", () => {
  beforeEach(() => {
    fakeSocket.removeAllListeners();
    push.mockClear();
    vi.unstubAllGlobals();
    Object.defineProperty(window, "ethereum", {
      value: undefined,
      configurable: true,
      writable: true,
    });
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
    await waitFor(() =>
      expect(emitSpy).toHaveBeenCalledWith("join_queue", { mode: "ARENA", stake: 0.1 }),
    );
    expect(screen.queryByTestId("stake-confirm-dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Searching for opponent/i)).toBeInTheDocument());
  });

  it("auto-opens the stake modal when Find Match is tapped but the ledger has insufficient balance", async () => {
    ledgerState = {
      balance: 0,
      refresh: vi.fn().mockResolvedValue(0),
    };
    render(<MatchmakingPage />);
    fireEvent.click(screen.getByText("$0.10"));
    const emitSpy = vi.spyOn(fakeSocket, "emit");
    fireEvent.click(screen.getByText("Find match"));
    await waitFor(() => expect(screen.getByTestId("stake-confirm-dialog")).toBeInTheDocument());
    expect(emitSpy).not.toHaveBeenCalledWith("join_queue", expect.anything());
  });

  it("auto-resumes matchmaking after stake confirmation if the ledger now covers the stake", async () => {
    mockEthereumSuccess();
    // First refresh (Find Match) returns 0 → modal opens because
    // ledger hasn't caught up. Second refresh (after stake
    // confirmation) returns 0.1 → auto-resumes the queue.
    let _refreshCalls = 0;
    ledgerState = {
      balance: 0,
      refresh: vi.fn().mockImplementation(async () => (_refreshCalls++ === 0 ? 0 : 0.1)),
    };
    render(<MatchmakingPage />);
    fireEvent.click(screen.getByText("$0.10"));
    const emitSpy = vi.spyOn(fakeSocket, "emit");
    fireEvent.click(screen.getByText("Find match"));
    await waitFor(() => expect(screen.getByTestId("stake-confirm-dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("stake-confirm-button"));
    await waitFor(() =>
      expect(emitSpy).toHaveBeenCalledWith("join_queue", { mode: "ARENA", stake: 0.1 }),
    );
    expect(screen.queryByTestId("stake-confirm-dialog")).not.toBeInTheDocument();
  });

  it("does NOT auto-resume if the ledger still shows 0 after stake confirmation — sets a 'queued' hint", async () => {
    mockEthereumSuccess();
    ledgerState = {
      balance: 0,
      refresh: vi.fn().mockImplementation(async () => 0),
    };
    render(<MatchmakingPage />);
    fireEvent.click(screen.getByText("$0.10"));
    const emitSpy = vi.spyOn(fakeSocket, "emit");
    fireEvent.click(screen.getByText("Find match"));
    await waitFor(() => expect(screen.getByTestId("stake-confirm-dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("stake-confirm-button"));
    // Don't refresh — server still sees 0 → "Deposit queued" hint
    await waitFor(() => expect(screen.getByText(/Deposit queued/i)).toBeInTheDocument());
    expect(emitSpy).not.toHaveBeenCalledWith(
      "join_queue",
      expect.objectContaining({ mode: "ARENA" }),
    );
  });

  it("hides the 'Insufficient balance for stake' banner once the stake modal is open", async () => {
    // The error banner lives on the matchmaking page. When the user
    // hits Find Match with insufficient balance, the modal opens —
    // but the modal already carries its own error indicator (the
    // StakeConfirmDialog has the same code in its errorMessage prop).
    // Showing both is redundant and confusing ("you can't sign" +
    // the actual signing dialog that lets them sign).
    ledgerState = {
      balance: 0,
      refresh: vi.fn().mockResolvedValue(0),
    };
    render(<MatchmakingPage />);
    fireEvent.click(screen.getByText("$0.10"));
    fireEvent.click(screen.getByText("Find match"));
    await waitFor(() => expect(screen.getByTestId("stake-confirm-dialog")).toBeInTheDocument());
    // The banner must NOT be visible behind the modal.
    expect(screen.queryByText(/Insufficient balance for stake/i)).not.toBeInTheDocument();
  });
});
