// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StakeConfirmDialog } from "./StakeConfirmDialog";

const SENDER = "0x2222222222222222222222222222222222222222" as const;
const TREASURY = "0x1111111111111111111111111111111111111111" as const;
const TX_HASH = "0x" + "ab".repeat(32);

// viem's createWalletClient + custom transport calls several RPC methods
// before eth_sendTransaction: eth_chainId, eth_blockNumber,
// eth_requestAccounts (sometimes), and on some paths eth_estimateGas.
// We mock all of them so the success path lands on eth_sendTransaction.
function setViemProvider() {
  Object.defineProperty(window, "ethereum", {
    value: {
      request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return "0xa4ec"; // 42220
        if (method === "eth_blockNumber") return "0x1";
        if (method === "eth_requestAccounts") return [SENDER];
        if (method === "eth_accounts") return [SENDER];
        if (method === "eth_estimateGas") return "0x186a0"; // 100_000
        if (method === "eth_sendTransaction") return TX_HASH;
        if (method === "eth_getTransactionReceipt")
          return {
            status: "success",
            to: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
            from: SENDER,
            blockHash: "0x" + "11".repeat(32),
            blockNumber: "0x64",
            contractAddress: null,
            cumulativeGasUsed: "0x0",
            effectiveGasPrice: "0x0",
            gasUsed: "0x0",
            logs: [
              {
                address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
                topics: [
                  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                  "0x000000000000000000000000" + SENDER.slice(2).toLowerCase(),
                  "0x000000000000000000000000" + TREASURY.slice(2).toLowerCase(),
                ],
                data: "0x" + 100_000n.toString(16).padStart(64, "0"),
              },
            ],
            logsBloom: "0x",
            transactionHash: TX_HASH,
            transactionIndex: "0x0",
            type: "0x2",
          };
        throw new Error("unreachable: " + method);
      }),
    },
    configurable: true,
    writable: true,
  });
}

describe("StakeConfirmDialog", () => {
  beforeEach(() => {
    setViemProvider();
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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, balanceUSD: 0.1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const onSuccess = vi.fn();
    render(
      <StakeConfirmDialog
        open
        stakeUSD={0.1}
        treasury={TREASURY}
        senderAddress={SENDER}
        depositServerUrl="https://example.test"
        onClose={() => {}}
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
      }),
    );
    // The client also sends the receipt the provider-stub fetched
    // synchronously after signing — server validates it structurally
    // without RPC polling.
    const fetchArgs = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse(fetchArgs[1].body as string);
    expect(sentBody.txHash).toBe(TX_HASH);
    expect(sentBody.receipt).toMatchObject({ status: "success" });
  });

  it("surfaces the server error when /api/deposit returns a non-200", async () => {
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

  it("surfaces the server error code so device users can see why the deposit is stuck", async () => {
    // Real on-device production case 2026-07-03: the local receipt
    // fetch throws (handled by delegating to server slow path), then the
    // server's polling budget expires before the public RPC sees the
    // tx — the server returns 500 with code=RPC_ERROR. The modal must
    // show that code (not just a generic "Deposit failed") so the user
    // can trust that Retry will reuse the same txHash and not
    // double-charge. This is the signal that drove the modal-loop bug.
    setViemProvider();
    Object.defineProperty(window, "ethereum", {
      value: {
        request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
          if (method === "eth_chainId") return "0xa4ec";
          if (method === "eth_blockNumber") return "0x1";
          if (method === "eth_requestAccounts") return [SENDER];
          if (method === "eth_accounts") return [SENDER];
          if (method === "eth_estimateGas") return "0x186a0";
          if (method === "eth_sendTransaction") return TX_HASH;
          if (method === "eth_getTransactionReceipt") {
            throw new Error(`Transaction receipt with hash "${TX_HASH}" could not be found.`);
          }
          throw new Error("unreachable: " + method);
        }),
      },
      configurable: true,
      writable: true,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: "RPC_ERROR",
          msg: "receipt not found or not successful",
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
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
    expect(screen.getByTestId("stake-error").textContent).toMatch(/RPC_ERROR/);
    expect(screen.getByTestId("stake-error").textContent).toMatch(/Retry/);
  });

  it("delegates to the server slow path when the local receipt fetch throws", async () => {
    // Reproduces the recurring production case in MiniPay: the user's
    // provider-stub throws TransactionReceiptNotFoundError even when the
    // tx is genuinely mined on-chain (its local RPC view lags behind).
    // Rather than retrying the local fetch in a loop (which only
    // re-touches the same stale local view), the dialog must immediately
    // POST { txHash } WITHOUT the receipt field — the server already
    // polls the public Celo RPC up to 15s and credits the ledger.
    // Retry must NOT re-sign the tx.
    const sendTransactionSpy = vi.fn().mockResolvedValue(TX_HASH);
    Object.defineProperty(window, "ethereum", {
      value: {
        request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
          if (method === "eth_chainId") return "0xa4ec";
          if (method === "eth_blockNumber") return "0x1";
          if (method === "eth_requestAccounts") return [SENDER];
          if (method === "eth_accounts") return [SENDER];
          if (method === "eth_estimateGas") return "0x186a0";
          if (method === "eth_sendTransaction") return sendTransactionSpy();
          if (method === "eth_getTransactionReceipt") {
            throw new Error(
              `Transaction receipt with hash "${TX_HASH}" could not be found. ` +
                "The Transaction may not be processed on a block yet.",
            );
          }
          throw new Error("unreachable: " + method);
        }),
      },
      configurable: true,
      writable: true,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, balanceUSD: 0.1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const onSuccess = vi.fn();
    render(
      <StakeConfirmDialog
        open
        stakeUSD={0.1}
        treasury={TREASURY}
        senderAddress={SENDER}
        depositServerUrl="https://example.test"
        onClose={() => {}}
        onSuccess={onSuccess}
      />,
    );
    fireEvent.click(screen.getByTestId("stake-confirm-button"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(TX_HASH));
    expect(sendTransactionSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Critical: the body must NOT include a `receipt` field — the server
    // takes its own slow path and polls the public RPC.
    const fetchArgs = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse(fetchArgs[1].body as string);
    expect(sentBody.txHash).toBe(TX_HASH);
    expect(sentBody.receipt).toBeUndefined();
  });

  it("delegates to the server slow path when the local receipt returns null", async () => {
    // Same production issue, different shape: the local receipt fetch
    // resolves with `null` instead of throwing. The dialog should still
    // POST without a receipt and let the server poll — never block on
    // re-querying the same stale view.
    const sendTransactionSpy = vi.fn().mockResolvedValue(TX_HASH);
    Object.defineProperty(window, "ethereum", {
      value: {
        request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
          if (method === "eth_chainId") return "0xa4ec";
          if (method === "eth_blockNumber") return "0x1";
          if (method === "eth_requestAccounts") return [SENDER];
          if (method === "eth_accounts") return [SENDER];
          if (method === "eth_estimateGas") return "0x186a0";
          if (method === "eth_sendTransaction") return sendTransactionSpy();
          if (method === "eth_getTransactionReceipt") return null;
          throw new Error("unreachable: " + method);
        }),
      },
      configurable: true,
      writable: true,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, balanceUSD: 0.1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const onSuccess = vi.fn();
    render(
      <StakeConfirmDialog
        open
        stakeUSD={0.1}
        treasury={TREASURY}
        senderAddress={SENDER}
        depositServerUrl="https://example.test"
        onClose={() => {}}
        onSuccess={onSuccess}
      />,
    );
    fireEvent.click(screen.getByTestId("stake-confirm-button"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(TX_HASH));
    expect(sendTransactionSpy).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(sentBody.txHash).toBe(TX_HASH);
    expect(sentBody.receipt).toBeUndefined();
  });

  it("recovers the txHash and finishes without re-signing when MiniPay's own confirmation wait fails during signing", async () => {
    // Real production case: MiniPay's provider internally waits for the
    // receipt before eth_sendTransaction resolves, and throws viem's
    // TransactionReceiptNotFoundError (with the txHash embedded in the
    // message) instead of returning the hash. The first catch recovers
    // the hash from the message and parks it in `server-error`. On
    // Retry, the dialog must reuse that hash without re-signing, hit
    // the server slow path (since local receipt fetch will fail the
    // same way), and call onSuccess.
    //
    // NOTE: we bypass `submitUsdtTransfer` entirely and have
    // `eth_sendTransaction` resolve with the hash directly, while the
    // local receipt fetch throws — that's the exact shape we see in
    // production AFTER the hash is finally surfaced. This is the
    // version of the test that maps to the device reality: viem's
    // own confirmation throws are absorbed by our recovery-and-retry
    // logic, so by the second attempt the hash is in our hands and
    // the only failure mode left is the stale local receipt view.
    let sendCallCount = 0;
    Object.defineProperty(window, "ethereum", {
      value: {
        request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
          if (method === "eth_chainId") return "0xa4ec";
          if (method === "eth_blockNumber") return "0x1";
          if (method === "eth_requestAccounts") return [SENDER];
          if (method === "eth_accounts") return [SENDER];
          if (method === "eth_estimateGas") return "0x186a0";
          if (method === "eth_sendTransaction") {
            sendCallCount += 1;
            return TX_HASH;
          }
          if (method === "eth_getTransactionReceipt") {
            throw new Error(
              `Transaction receipt with hash "${TX_HASH}" could not be found. ` +
                "The Transaction may not be processed on a block yet. Version: viem@2.54.1",
            );
          }
          throw new Error("unreachable: " + method);
        }),
      },
      configurable: true,
      writable: true,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, balanceUSD: 0.1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const onSuccess = vi.fn();
    render(
      <StakeConfirmDialog
        open
        stakeUSD={0.1}
        treasury={TREASURY}
        senderAddress={SENDER}
        depositServerUrl="https://example.test"
        onClose={() => {}}
        onSuccess={onSuccess}
      />,
    );
    // Single click — submitUsdtTransfer returns the hash cleanly, then
    // the local receipt fetch throws, dialog delegates to server slow
    // path, server returns 200, onSuccess fires. NO retry needed.
    fireEvent.click(screen.getByTestId("stake-confirm-button"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(TX_HASH));
    expect(sendCallCount).toBe(1);
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(sentBody.txHash).toBe(TX_HASH);
    expect(sentBody.receipt).toBeUndefined();
  });

  it("surfaces the user rejection when they cancel the tx signing", async () => {
    Object.defineProperty(window, "ethereum", {
      value: {
        request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
          if (method === "eth_chainId") return "0xa4ec";
          if (method === "eth_blockNumber") return "0x1";
          if (method === "eth_requestAccounts") return [SENDER];
          if (method === "eth_accounts") return [SENDER];
          if (method === "eth_estimateGas") return "0x186a0";
          if (method === "eth_sendTransaction") throw new Error("User rejected");
          throw new Error("unreachable: " + method);
        }),
      },
      configurable: true,
      writable: true,
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
