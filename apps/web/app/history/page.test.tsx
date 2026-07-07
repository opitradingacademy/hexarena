// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { getAddress } from "viem";

const push = vi.fn();

type ResolvedWallet = string | null;
let wallet: ResolvedWallet = null;

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};
let nextFetch: FetchResponse | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("../../lib/waitForEthereum", () => ({
  waitForEthereum: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/wallet", () => ({
  getWalletAddress: vi.fn().mockImplementation(async () => wallet),
}));

vi.mock("../../lib/serverUrl", () => ({
  getServerUrl: () => "https://example.test",
}));

vi.mock("../../lib/socketSingleton", () => ({
  getSocket: () => ({
    connected: true,
    id: "SHOULD-NOT-BE-USED",
    connect: vi.fn(),
  }),
}));

beforeEach(() => {
  wallet = null;
  nextFetch = null;
  push.mockReset();
  // Default fetch: 404 so we exercise the early-return path.
  globalThis.fetch = vi.fn().mockImplementation(async () => {
    if (nextFetch) return nextFetch;
    return { ok: false, status: 404, json: async () => ({}) } satisfies FetchResponse;
  }) as never;
});

import HistoryPage from "./page";

describe("HistoryPage", () => {
  it("uses the wallet address (not socket.id) as the userId when fetching matches", async () => {
    // The page must canonicalize via viem's getAddress (same as the
    // server) so the casing in the URL matches what's in the ledger.
    wallet = "0x34d5d015b4805e985619d0f4aacb6343a6457ff2";
    const expected = getAddress(wallet);
    nextFetch = { ok: true, status: 200, json: async () => [] };

    render(<HistoryPage />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    const calledUrl = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock
      .calls[0][0];
    // Must use the canonical wallet, NOT socket.id. The mock getSocket
    // exposes id "SHOULD-NOT-BE-USED" — if that leaks into the URL the
    // test fails.
    expect(calledUrl).toContain(`/matches/${expected}`);
    expect(calledUrl).not.toContain("SHOULD-NOT-BE-USED");
    // Must not be the raw lowercase — server compares with getAddress,
    // so the URL has to match the canonical form.
    expect(calledUrl).not.toContain(`/matches/${wallet}`);
  });

  it("renders a WIN row when the server returns a won Arena match", async () => {
    const raw = "0x34d5d015b4805e985619d0f4aacb6343a6457ff2";
    wallet = raw;
    // The server stores matches with the canonical (getAddress) wallet
    // as p1/p2/winner. Mirror that in the test payload.
    const canonical = getAddress(raw);
    nextFetch = {
      ok: true,
      status: 200,
      json: async () => [
        {
          id: "m1",
          mode: "ARENA",
          p1: canonical,
          p2: "0x0000000000000000000000000000000000000001",
          winner: canonical,
          stake: 0.1,
          createdAt: Date.UTC(2026, 6, 7),
        },
      ],
    };

    render(<HistoryPage />);

    const row = await screen.findByTestId("history-row-m1");
    expect(row).toHaveTextContent("WIN");
    // WIN Arena: stake * 0.8 = $0.08
    expect(row).toHaveTextContent("+$0.08");
  });

  it("renders the empty-state copy while the wallet is still resolving", () => {
    wallet = null;
    // No fetch will fire — early return in the load effect.
    render(<HistoryPage />);
    expect(screen.getByTestId("history-empty")).toHaveTextContent(
      "No matches yet — play your first game.",
    );
  });

  it("leaves entries untouched when the fetch returns a non-ok response", async () => {
    wallet = "0x34D5d015B4805E985619D0F4aaCb6343a6457fF2";
    nextFetch = { ok: false, status: 500, json: async () => ({}) };

    render(<HistoryPage />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    // Empty state still shown — the failed fetch didn't crash and didn't
    // populate entries with garbage.
    expect(screen.getByTestId("history-empty")).toBeInTheDocument();
  });
});
