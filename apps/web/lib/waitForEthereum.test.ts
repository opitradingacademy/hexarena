// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { waitForEthereum } from "./waitForEthereum";

describe("waitForEthereum", () => {
  const originalEthereum = window.ethereum;

  beforeEach(() => {
    delete (window as { ethereum?: unknown }).ethereum;
  });

  afterEach(() => {
    window.ethereum = originalEthereum;
    vi.useRealTimers();
  });

  it("resolves true immediately when window.ethereum is already present", async () => {
    (window as { ethereum?: unknown }).ethereum = { isMiniPay: true };
    await expect(waitForEthereum()).resolves.toBe(true);
  });

  it("resolves true once the ethereum#initialized event fires", async () => {
    const promise = waitForEthereum(1000);
    (window as { ethereum?: unknown }).ethereum = { isMiniPay: true };
    window.dispatchEvent(new Event("ethereum#initialized"));
    await expect(promise).resolves.toBe(true);
  });

  it("resolves false after the timeout when nothing ever injects", async () => {
    vi.useFakeTimers();
    const promise = waitForEthereum(1000);
    vi.advanceTimersByTime(1001);
    await expect(promise).resolves.toBe(false);
  });
});
