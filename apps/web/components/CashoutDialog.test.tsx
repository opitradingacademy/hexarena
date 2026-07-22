// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CashoutDialog } from "./CashoutDialog";

const WALLET = "0x2222222222222222222222222222222222222222" as const;
const TX_HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;

// Mock the request module so no real network goes out.
vi.mock("../lib/cashout", async () => {
  const actual = await vi.importActual<typeof import("../lib/cashout")>("../lib/cashout");
  return {
    ...actual,
    requestCashout: vi.fn(),
  };
});

// Import after the mock so the mocked function is wired.
import { requestCashout, CashoutError, type CashoutSuccessResponse } from "../lib/cashout";
const mockedRequest = vi.mocked(requestCashout);

const CONFIRMATION_BODY: CashoutSuccessResponse = {
  ok: true,
  balanceUSD: 0.42,
  withdrawal: {
    id: "w-1",
    status: "CONFIRMED",
    txHash: TX_HASH,
    amountUSD: 0.1,
    amountRaw: 0.1015,
    netReceivedUSD: 0.1,
    createdAt: 1,
    confirmedAt: 2,
    failedAt: null,
  },
};

function defaultProps() {
  return {
    open: true,
    amountUSD: 0.1,
    wallet: WALLET,
    gameBalanceUSD: 0.42,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };
}

beforeEach(() => {
  localStorage.clear();
  mockedRequest.mockReset();
});

describe("CashoutDialog", () => {
  it("renders nothing when `open` is false", () => {
    const { container } = render(<CashoutDialog {...defaultProps()} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the amount and a truncated destination wallet", () => {
    render(<CashoutDialog {...defaultProps()} />);
    expect(screen.getByTestId("cashout-dialog")).toBeInTheDocument();
    // The truncated wallet uses 0x + 4 chars + … + 4 chars. The
    // copy-rules checker would reject a full 0x... string anywhere in
    // rendered text (regex 0x[0-9a-fA-F]{6,}); truncating to 4 hex
    // chars after 0x keeps the dialog lint-clean.
    expect(screen.getByTestId("destination-wallet").textContent).toBe("0x2222…2222");
    // Confirms the full address is never rendered anywhere in the DOM.
    expect(screen.getByTestId("cashout-dialog").textContent).not.toContain(WALLET);
    // The amount appears twice: once in the "approximately $0.10"
    // summary and once in the primary button label.
    expect(screen.getAllByText(/\$0\.10/).length).toBeGreaterThan(0);
  });

  it("renders the absorbed service-fee info (not 'gas'/'network fee'/'crypto')", () => {
    render(<CashoutDialog {...defaultProps()} />);
    const note = screen.getByTestId("service-fee-note");
    expect(note.textContent).toMatch(/service fee/i);
    expect(screen.getByTestId("cashout-dialog").textContent).not.toMatch(
      /\bgas\b|\bnetwork fee\b|\bcrypto\b/,
    );
  });

  it("Cancel button calls onClose", () => {
    const onClose = vi.fn();
    render(<CashoutDialog {...defaultProps()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("cashout-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking Cash out $0.10 POSTs via requestCashout and calls onSuccess on 200", async () => {
    mockedRequest.mockResolvedValueOnce(CONFIRMATION_BODY);
    const onSuccess = vi.fn();
    render(<CashoutDialog {...defaultProps()} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByTestId("cashout-confirm"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess).toHaveBeenCalledWith(TX_HASH, 0.1);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const call = mockedRequest.mock.calls[0][0];
    expect(call.wallet).toBe(WALLET);
    expect(call.amountUSD).toBe(0.1);
    expect(call.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("surfaces the server error code on 422 CASHOUT_FAILED and shows Retry + Try again", async () => {
    mockedRequest.mockRejectedValueOnce(
      new CashoutError("CASHOUT_FAILED", "execution reverted", 422),
    );
    render(<CashoutDialog {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("cashout-confirm"));

    await waitFor(() => expect(screen.getByTestId("cashout-error-code")).toBeInTheDocument());
    expect(screen.getByTestId("cashout-error-code").textContent).toMatch(/CASHOUT_FAILED/);
    expect(screen.getByTestId("cashout-error-message").textContent).toMatch(/execution reverted/);
    expect(screen.getByTestId("cashout-retry")).toBeInTheDocument();
    expect(screen.getByTestId("cashout-try-again")).toBeInTheDocument();
  });

  it("surfaces INSUFFICIENT_BALANCE specifically (server-side path)", async () => {
    // Use amounts that pass the client-side pre-check (0.2 <= 0.42
    // is fine) so the request actually flies; the server is the
    // source of truth for the balance check, simulating a race
    // condition where the user's balance dropped between page-load
    // and click.
    mockedRequest.mockRejectedValueOnce(
      new CashoutError("INSUFFICIENT_BALANCE", "amountUSD exceeds available balance", 422),
    );
    render(<CashoutDialog {...defaultProps()} amountUSD={0.2} gameBalanceUSD={0.42} />);
    fireEvent.click(screen.getByTestId("cashout-confirm"));

    await waitFor(() => expect(screen.getByTestId("cashout-error-code")).toBeInTheDocument());
    expect(screen.getByTestId("cashout-error-code").textContent).toMatch(/INSUFFICIENT_BALANCE/);
    expect(mockedRequest).toHaveBeenCalled();
  });

  it("Retry on failure re-uses the SAME idempotency key (idempotent replay)", async () => {
    // First call: transient NETWORK failure.
    mockedRequest.mockRejectedValueOnce(new CashoutError("NETWORK", "Failed to fetch", 0));
    // Second call: success on replay.
    mockedRequest.mockResolvedValueOnce(CONFIRMATION_BODY);
    const onSuccess = vi.fn();
    render(<CashoutDialog {...defaultProps()} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByTestId("cashout-confirm"));
    await waitFor(() => expect(screen.getByTestId("cashout-retry")).toBeInTheDocument());

    const firstKey = mockedRequest.mock.calls[0][0].idempotencyKey;
    fireEvent.click(screen.getByTestId("cashout-retry"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    const secondKey = mockedRequest.mock.calls[1][0].idempotencyKey;
    expect(secondKey).toBe(firstKey);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it("Try again after a terminal failure uses a NEW idempotency key", async () => {
    // CASHOUT_FAILED is terminal — the dialog clears the stored key
    // and bumps the attempt counter, so a Try again generates a
    // fresh uuid v4 (different from the first one).
    mockedRequest.mockRejectedValueOnce(
      new CashoutError("CASHOUT_FAILED", "execution reverted", 422),
    );
    mockedRequest.mockResolvedValueOnce(CONFIRMATION_BODY);
    const onSuccess = vi.fn();
    render(<CashoutDialog {...defaultProps()} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByTestId("cashout-confirm"));
    await waitFor(() => expect(screen.getByTestId("cashout-try-again")).toBeInTheDocument());

    const firstKey = mockedRequest.mock.calls[0][0].idempotencyKey;
    fireEvent.click(screen.getByTestId("cashout-try-again"));
    // After Try again, status flips back to idle so the Cash out
    // button reappears. Click it to fire the second request.
    await waitFor(() => expect(screen.getByTestId("cashout-confirm")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("cashout-confirm"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const secondKey = mockedRequest.mock.calls[1][0].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  it("Try again after 409 IDEMPOTENCY_CONFLICT uses a NEW idempotency key", async () => {
    // The server returned 409 because the on-chain `withdrawn[]`
    // guard already burned keccak256(key) for this exact key. Same
    // key will always revert — the dialog must clear and bump
    // attempt so the next call hashes to a fresh bytes32.
    mockedRequest.mockRejectedValueOnce(
      new CashoutError(
        "IDEMPOTENCY_CONFLICT",
        "Cash-out already processed on-chain; please contact support with your wallet and Idempotency-Key.",
        409,
      ),
    );
    mockedRequest.mockResolvedValueOnce(CONFIRMATION_BODY);
    const onSuccess = vi.fn();
    render(<CashoutDialog {...defaultProps()} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByTestId("cashout-confirm"));
    await waitFor(() => expect(screen.getByTestId("cashout-error-code")).toBeInTheDocument());
    expect(screen.getByTestId("cashout-error-code").textContent).toMatch(/IDEMPOTENCY_CONFLICT/);

    const firstKey = mockedRequest.mock.calls[0][0].idempotencyKey;
    fireEvent.click(screen.getByTestId("cashout-try-again"));
    await waitFor(() => expect(screen.getByTestId("cashout-confirm")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("cashout-confirm"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const secondKey = mockedRequest.mock.calls[1][0].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  it("network error shows the error message and keeps the dialog open", async () => {
    mockedRequest.mockRejectedValueOnce(
      new CashoutError("NETWORK", "Network error — check your connection", 0),
    );
    render(<CashoutDialog {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("cashout-confirm"));

    await waitFor(() => expect(screen.getByTestId("cashout-error")).toBeInTheDocument());
    expect(screen.getByTestId("cashout-error-message").textContent).toMatch(/network/i);
    expect(screen.getByTestId("cashout-retry")).toBeInTheDocument();
  });

  it("blocks the request client-side when amount exceeds game balance", async () => {
    // The pre-check fires a client-error WITHOUT calling requestCashout.
    render(<CashoutDialog {...defaultProps()} amountUSD={5} gameBalanceUSD={0.42} />);
    fireEvent.click(screen.getByTestId("cashout-confirm"));

    await waitFor(() => expect(screen.getByTestId("cashout-error")).toBeInTheDocument());
    expect(screen.getByTestId("cashout-error-message").textContent).toMatch(
      /exceeds your Game Balance/i,
    );
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("blocks the request client-side when amount is below $0.10 minimum", () => {
    render(<CashoutDialog {...defaultProps()} amountUSD={0.05} gameBalanceUSD={0.42} />);
    fireEvent.click(screen.getByTestId("cashout-confirm"));

    expect(screen.getByTestId("cashout-error-message").textContent).toMatch(
      /minimum cash out is \$0\.10/i,
    );
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("disables the primary button during submission (no double-click)", async () => {
    let resolve!: (v: CashoutSuccessResponse) => void;
    mockedRequest.mockImplementationOnce(
      () =>
        new Promise<CashoutSuccessResponse>((r) => {
          resolve = r;
        }),
    );
    render(<CashoutDialog {...defaultProps()} />);
    const btn = screen.getByTestId("cashout-confirm");
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(btn.textContent).toMatch(/processing/i);

    // Click again while submitting — should not trigger another
    // request.
    fireEvent.click(btn);
    expect(mockedRequest).toHaveBeenCalledTimes(1);

    // Resolve the request to clean up.
    resolve(CONFIRMATION_BODY);
  });
});
