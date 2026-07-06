// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  generateUuidV4,
  getOrCreateIdempotencyKey,
  clearIdempotencyKey,
} from "./cashoutIdempotency";

const WALLET = "0x2222222222222222222222222222222222222222" as const;

describe("generateUuidV4", () => {
  it("returns an RFC 4122 v4 string", () => {
    const id = generateUuidV4();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("returns different values on successive calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 25; i++) ids.add(generateUuidV4());
    // Probability of collision in 25 trials with a 122-bit key is
    // effectively zero; if this ever flakes we have a real bug.
    expect(ids.size).toBe(25);
  });

  it("prefers the native crypto.randomUUID when available", () => {
    const sentinel =
      "0" +
      "1".repeat(7) +
      "-2" +
      "3".repeat(3) +
      "-4" +
      "5".repeat(3) +
      "-a" +
      "6".repeat(3) +
      "-" +
      "7".repeat(12);
    const randomUUID = vi.fn(() => sentinel);
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID },
      configurable: true,
      writable: true,
    });
    try {
      const id = generateUuidV4();
      expect(randomUUID).toHaveBeenCalledTimes(1);
      expect(id).toBe(sentinel);
    } finally {
      if (original) Object.defineProperty(globalThis, "crypto", original);
    }
  });
});

describe("getOrCreateIdempotencyKey / clearIdempotencyKey", () => {
  beforeEach(() => {
    if (typeof localStorage?.clear === "function") localStorage.clear();
  });

  it("creates and persists a fresh uuid on first call", () => {
    const key = getOrCreateIdempotencyKey({ wallet: WALLET, amountUSD: 0.1, attempt: 0 });
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    // Stored under the namespaced key.
    const stored = localStorage.getItem(`hexarena.cashout.idempotency.${WALLET}.0.1.0`);
    expect(stored).toBe(key);
  });

  it("returns the same key on subsequent calls with the same args", () => {
    const a = getOrCreateIdempotencyKey({ wallet: WALLET, amountUSD: 0.1, attempt: 0 });
    const b = getOrCreateIdempotencyKey({ wallet: WALLET, amountUSD: 0.1, attempt: 0 });
    expect(a).toBe(b);
  });

  it("isolates keys across different amounts (same attempt)", () => {
    const a = getOrCreateIdempotencyKey({ wallet: WALLET, amountUSD: 0.1, attempt: 0 });
    const b = getOrCreateIdempotencyKey({ wallet: WALLET, amountUSD: 0.25, attempt: 0 });
    expect(a).not.toBe(b);
  });

  it("isolates keys across different attempts (same amount)", () => {
    const a = getOrCreateIdempotencyKey({ wallet: WALLET, amountUSD: 0.1, attempt: 0 });
    const b = getOrCreateIdempotencyKey({ wallet: WALLET, amountUSD: 0.1, attempt: 1 });
    expect(a).not.toBe(b);
  });

  it("regenerates a fresh key after clearIdempotencyKey", () => {
    const a = getOrCreateIdempotencyKey({ wallet: WALLET, amountUSD: 0.1, attempt: 0 });
    clearIdempotencyKey({ wallet: WALLET, amountUSD: 0.1, attempt: 0 });
    const b = getOrCreateIdempotencyKey({ wallet: WALLET, amountUSD: 0.1, attempt: 0 });
    expect(b).not.toBe(a);
  });

  it("clearIdempotencyKey is a no-op when nothing is stored", () => {
    expect(() => clearIdempotencyKey({ wallet: WALLET, amountUSD: 0.1, attempt: 0 })).not.toThrow();
  });

  it("regenerates if the stored value is malformed", () => {
    localStorage.setItem(`hexarena.cashout.idempotency.${WALLET}.0.1.0`, "not-a-uuid");
    const key = getOrCreateIdempotencyKey({ wallet: WALLET, amountUSD: 0.1, attempt: 0 });
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("returns a fresh uuid (not null) when localStorage throws — the dialog still submits", () => {
    // localStorage.setItem can throw in private-browsing-like contexts;
    // we want the user to STILL be able to submit, just without
    // cross-reload persistence. generateUuidV4() runs even when
    // storage throws.
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      const key = getOrCreateIdempotencyKey({
        wallet: WALLET,
        amountUSD: 0.1,
        attempt: 0,
      });
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    } finally {
      setItemSpy.mockRestore();
    }
  });
});
