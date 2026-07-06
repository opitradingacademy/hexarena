// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { requestCashout, CashoutError } from "./cashout";

const WALLET = "0x2222222222222222222222222222222222222222" as const;
const SERVER = "https://api.test";
const KEY = "01234567-89ab-4cde-9000-1234567890ab";

describe("requestCashout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to /api/cashout with the required headers and body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          balanceUSD: 0.42,
          withdrawal: {
            id: "w-1",
            status: "CONFIRMED",
            txHash: "0x" + "ab".repeat(32),
            amountUSD: 0.1,
            amountRaw: 0.1,
            netReceivedUSD: 0.1,
            createdAt: 1,
            confirmedAt: 2,
            failedAt: null,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await requestCashout({
      serverUrl: SERVER,
      wallet: WALLET,
      amountUSD: 0.1,
      idempotencyKey: KEY,
    });
    expect(result.ok).toBe(true);
    expect(result.withdrawal.status).toBe("CONFIRMED");
    expect(fetchSpy).toHaveBeenCalledWith(
      `${SERVER}/api/cashout`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-wallet-address": WALLET,
          "idempotency-key": KEY,
        }),
        body: JSON.stringify({ amountUSD: 0.1 }),
      }),
    );
  });

  it("returns the parsed success body when the server replies 200", async () => {
    const body = {
      ok: true,
      balanceUSD: 0.42,
      withdrawal: {
        id: "w-2",
        status: "CONFIRMED",
        txHash: ("0x" + "cd".repeat(32)) as `0x${string}`,
        amountUSD: 0.1,
        amountRaw: 0.1015,
        netReceivedUSD: 0.1,
        createdAt: 10,
        confirmedAt: 11,
        failedAt: null,
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await requestCashout({
      serverUrl: SERVER,
      wallet: WALLET,
      amountUSD: 0.1,
      idempotencyKey: KEY,
    });
    expect(result).toEqual(body);
    expect(result.withdrawal.txHash).toBe("0x" + "cd".repeat(32));
  });

  it("passes through idempotent_replay responses unchanged", async () => {
    const body = {
      ok: true,
      idempotent_replay: true,
      balanceUSD: 0.42,
      withdrawal: {
        id: "w-3",
        status: "CONFIRMED",
        txHash: ("0x" + "ee".repeat(32)) as `0x${string}`,
        amountUSD: 0.1,
        amountRaw: 0.1015,
        netReceivedUSD: 0.1,
        createdAt: 10,
        confirmedAt: 11,
        failedAt: null,
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await requestCashout({
      serverUrl: SERVER,
      wallet: WALLET,
      amountUSD: 0.1,
      idempotencyKey: KEY,
    });
    expect(result.idempotent_replay).toBe(true);
  });

  it("throws CashoutError with INSUFFICIENT_BALANCE on 422 INSUFFICIENT_BALANCE", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: "INSUFFICIENT_BALANCE",
          msg: "amountUSD exceeds available balance",
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      requestCashout({
        serverUrl: SERVER,
        wallet: WALLET,
        amountUSD: 5,
        idempotencyKey: KEY,
      }),
    ).rejects.toMatchObject({
      name: "CashoutError",
      code: "INSUFFICIENT_BALANCE",
      status: 422,
    });
  });

  it("throws CashoutError with CASHOUT_FAILED on 422 CASHOUT_FAILED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: "CASHOUT_FAILED",
          msg: "execution reverted: data: 0x",
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      requestCashout({
        serverUrl: SERVER,
        wallet: WALLET,
        amountUSD: 0.1,
        idempotencyKey: KEY,
      }),
    ).rejects.toMatchObject({
      code: "CASHOUT_FAILED",
      status: 422,
    });
  });

  it("throws CashoutError with BELOW_MINIMUM on 422 BELOW_MINIMUM", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: "BELOW_MINIMUM",
          msg: "amountUSD must be >= 0.1",
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      requestCashout({
        serverUrl: SERVER,
        wallet: WALLET,
        amountUSD: 0.05,
        idempotencyKey: KEY,
      }),
    ).rejects.toMatchObject({ code: "BELOW_MINIMUM" });
  });

  it("throws CashoutError with IDEMPOTENCY_CONFLICT on 409", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: "IDEMPOTENCY_CONFLICT",
          msg: "Idempotency-Key already used with a different amount",
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      requestCashout({
        serverUrl: SERVER,
        wallet: WALLET,
        amountUSD: 0.1,
        idempotencyKey: KEY,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
  });

  it("throws CashoutError with NETWORK code when fetch itself rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(
      requestCashout({
        serverUrl: SERVER,
        wallet: WALLET,
        amountUSD: 0.1,
        idempotencyKey: KEY,
      }),
    ).rejects.toBeInstanceOf(CashoutError);
    await expect(
      requestCashout({
        serverUrl: SERVER,
        wallet: WALLET,
        amountUSD: 0.1,
        idempotencyKey: KEY,
      }),
    ).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("falls back to HTTP_<status> when the server body has no code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("internal error", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );
    await expect(
      requestCashout({
        serverUrl: SERVER,
        wallet: WALLET,
        amountUSD: 0.1,
        idempotencyKey: KEY,
      }),
    ).rejects.toMatchObject({ code: "HTTP_500", status: 500 });
  });
});
