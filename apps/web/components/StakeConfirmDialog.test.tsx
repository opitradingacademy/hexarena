// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StakeConfirmDialog } from "./StakeConfirmDialog";

const SENDER = "0x2222222222222222222222222222222222222222" as const;
const TREASURY = "0x1111111111111111111111111111111111111111" as const;
const TX_HASH = "0x" + "ab".repeat(32);

// Narrower type assertion than the global Window['ethereum']
// declaration that lives elsewhere in the suite — we only need a
// request shape for these dialog tests.
function setWindowEthereum(
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>,
) {
  Object.defineProperty(window, "ethereum", {
    value: { request },
    configurable: true,
    writable: true,
  });
}

describe("StakeConfirmDialog", () => {
  beforeEach(() => {
    setWindowEthereum(async () => TX_HASH);
  });

  it("renders nothing when `open` is false", () => {
    const { container } = render(
      <StakeConfirmDialog
        open={false}
        stakeUSD={0.1}
        treasury={TREASURY}
        senderAddress={SENDER}
        depositServerUrl="https://example.test"
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the stake amount and a primary confirm action when open", () => {
    render(
      <StakeConfirmDialog
        open
        stakeUSD={0.1}
        treasury={TREASURY}
        senderAddress={SENDER}
        depositServerUrl="https://example.test"
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );
    expect(screen.getByTestId("stake-confirm-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("stake-confirm-button")).toBeInTheDocument();
    expect(screen.getAllByText(/\$0\.10/).length).toBeGreaterThan(0);
  });

  it("submits a USDT transfer, POSTs the txHash, and calls onSuccess", async () => {
    setWindowEthereum(async () => TX_HASH);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, balanceUSD: 0.1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <StakeConfirmDialog
        open
        stakeUSD={0.1}
        treasury={TREASURY}
        senderAddress={SENDER}
        depositServerUrl="https://example.test"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    fireEvent.click(screen.getByTestId("stake-confirm-button"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess).toHaveBeenCalledWith(TX_HASH);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.test",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-wallet-address": SENDER,
          "content-type": "application/json",
        }),
        body: JSON.stringify({ txHash: TX_HASH }),
      }),
    );
  });

  it("surfaces the server error when /api/deposit returns a non-200", async () => {
    setWindowEthereum(async () => TX_HASH);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, code: "DUPLICATE_TX" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    render(
      <StakeConfirmDialog
        open
        stakeUSD={0.1}
        treasury={TREASURY}
        senderAddress={SENDER}
        depositServerUrl="https://example.test"
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("stake-confirm-button"));
    await waitFor(() => expect(screen.getByTestId("stake-error")).toBeInTheDocument());
    expect(screen.getByTestId("stake-error").textContent).toMatch(/Deposit failed/);
  });

  it("surfaces the user rejection when they cancel the tx signing", async () => {
    setWindowEthereum(async () => {
      throw new Error("User rejected");
    });
    render(
      <StakeConfirmDialog
        open
        stakeUSD={0.1}
        treasury={TREASURY}
        senderAddress={SENDER}
        depositServerUrl="https://example.test"
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("stake-confirm-button"));
    await waitFor(() => expect(screen.getByTestId("stake-error")).toBeInTheDocument());
    expect(screen.getByTestId("stake-error").textContent).toMatch(/User rejected|reject/i);
  });
});
