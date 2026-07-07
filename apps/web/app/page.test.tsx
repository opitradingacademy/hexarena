// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EventEmitter } from "node:events";

const push = vi.fn();

type LedgerState = { balance: number; refresh: () => Promise<number> };
let ledgerState: LedgerState = {
  balance: 0.42,
  refresh: vi.fn().mockResolvedValue(0.42),
};

type WalletState = { balance: number; reload: () => void };
let walletState: WalletState = {
  balance: 1.0,
  reload: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("../lib/useServerLedger", () => ({
  useServerLedger: () => ({
    loading: false,
    balance: ledgerState.balance,
    error: undefined,
    refresh: ledgerState.refresh,
  }),
}));

vi.mock("../lib/useUsdtBalance", () => ({
  useUsdtBalance: () => ({
    loading: false,
    balance: walletState.balance,
    error: undefined,
    reload: walletState.reload,
  }),
}));

vi.mock("../lib/useIsMiniPay", () => ({
  useIsMiniPay: () => false,
}));

vi.mock("../lib/waitForEthereum", () => ({
  waitForEthereum: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/wallet", () => ({
  getWalletAddress: vi.fn().mockResolvedValue("0x2222222222222222222222222222222222222222"),
}));

vi.mock("../lib/serverUrl", () => ({
  getArenaTreasuryAddress: () => "0x1111111111111111111111111111111111111111",
  getDepositUrl: () => "https://example.test/api/deposit",
}));

// Stub socket imports the dashboard indirectly references via the
// page tree (no real socket use, but stops import errors).
class _FakeSocket extends EventEmitter {
  connected = true;
  connect = vi.fn();
}
const _fakeSocket = new _FakeSocket();
vi.mock("../lib/socketSingleton", () => ({
  getSocket: () => _fakeSocket,
}));

import DashboardPage from "./page";

beforeEach(() => {
  push.mockReset();
  ledgerState.refresh = vi.fn().mockResolvedValue(ledgerState.balance);
  walletState.reload = vi.fn();
});

describe("DashboardPage", () => {
  it("renders Game Balance and Wallet Balance labels", () => {
    render(<DashboardPage />);
    expect(screen.getByText(/Game Balance/i)).toBeInTheDocument();
    expect(screen.getByText(/Wallet Balance/i)).toBeInTheDocument();
    // Game balance value should be the formatted USD number.
    expect(screen.getAllByText(/\$0\.42/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$1\.00/).length).toBeGreaterThan(0);
  });

  it("renders the 'Cash out' button (not 'Withdraw')", () => {
    render(<DashboardPage />);
    const btn = screen.getByTestId("cashout-open");
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toMatch(/Cash out/i);
    // Make sure the legacy "Withdraw" label is gone.
    expect(screen.queryByText(/^Withdraw$/)).not.toBeInTheDocument();
  });

  it("opens the cash-out step-1 modal when 'Cash out' is clicked", () => {
    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId("cashout-open"));
    expect(screen.getByTestId("cashout-step1")).toBeInTheDocument();
    // Chips for amounts the user can afford.
    expect(screen.getAllByTestId("cashout-chip").length).toBeGreaterThan(0);
  });

  it("selecting an amount and confirming advances to the CashoutDialog (step 2)", async () => {
    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId("cashout-open"));
    // Click the first chip.
    const firstChip = screen.getAllByTestId("cashout-chip")[0];
    fireEvent.click(firstChip);
    // Step 2 opens the CashoutDialog once the wallet resolves.
    await waitFor(() => expect(screen.getByTestId("cashout-dialog")).toBeInTheDocument());
    // Confirm button is the primary CTA in the dialog.
    expect(screen.getByTestId("cashout-confirm")).toBeInTheDocument();
  });

  it("disables the Cash out button when the game balance is 0", () => {
    ledgerState = { balance: 0, refresh: vi.fn().mockResolvedValue(0) };
    render(<DashboardPage />);
    const btn = screen.getByTestId("cashout-open");
    expect(btn).toBeDisabled();
  });

  it("does not render the 'Recent matches' section on the Dashboard", () => {
    render(<DashboardPage />);
    // The "Recent matches" heading was removed from the Home in favor
    // of the dedicated History tab in the BottomNav — the Dashboard
    // should not duplicate the empty state. History lives at /history.
    expect(screen.queryByText(/Recent matches/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("history-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("history-list")).not.toBeInTheDocument();
  });
});
