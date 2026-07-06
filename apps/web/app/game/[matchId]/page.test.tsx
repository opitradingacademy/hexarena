// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { EventEmitter } from "node:events";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ matchId: "m1" }),
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("color=P1&opponent=0xHOST"),
}));

class FakeSocket extends EventEmitter {
  connected = true;
  connect = vi.fn();
}
const fakeSocket = new FakeSocket();
vi.mock("../../../lib/socketSingleton", () => ({
  getSocket: () => fakeSocket,
}));

vi.mock("../../../components/HexBoard", () => ({
  HexBoard: () => <div data-testid="hex-board-mock" />,
  PIECE_COLOR: { P1: "bg-arena-cyan", P2: "bg-arena-magenta" },
  PIECE_COLOR_NAME: { P1: "Cyan", P2: "Magenta" },
}));

vi.mock("../../../components/MatchClock", () => ({
  MatchClock: ({ matchClockMs }: { matchClockMs: number }) => (
    <div data-testid="match-clock">{matchClockMs}</div>
  ),
}));

vi.mock("../../../components/PlayerStatusRow", () => ({
  PlayerStatusRow: () => <div data-testid="player-status-row" />,
}));

vi.mock("../../../components/ResultBanner", () => ({
  ResultBanner: ({ result }: { result: { winner: string | null; reason: string } }) => (
    <div data-testid="result-banner" data-winner={result.winner} data-reason={result.reason} />
  ),
}));

vi.mock("@hexarena/shared/domain/bot", () => ({
  BOT_USER_ID: "BOT",
}));

import GamePage from "./page";

describe("GamePage — initial state and socket wiring", () => {
  beforeEach(() => {
    fakeSocket.removeAllListeners();
    push.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits resume with the matchId on mount", () => {
    const emitSpy = vi.spyOn(fakeSocket, "emit");
    render(<GamePage />);
    expect(emitSpy).toHaveBeenCalledWith("resume", { matchId: "m1" });
  });

  it("renders the page with the match clock and player status rows when no snapshot has arrived yet", () => {
    render(<GamePage />);
    expect(screen.getByTestId("match-clock")).toBeInTheDocument();
    expect(screen.getAllByTestId("player-status-row").length).toBe(2);
    // No toast on initial render.
    expect(screen.queryByTestId("move-rejected-toast")).not.toBeInTheDocument();
  });

  it("does not show the toast when message is null", () => {
    render(<GamePage />);
    expect(screen.queryByTestId("move-rejected-toast")).not.toBeInTheDocument();
  });
});

describe("GamePage — match_state_snapshot hydration", () => {
  beforeEach(() => {
    fakeSocket.removeAllListeners();
    push.mockClear();
  });

  it("hydrates state from match_state_snapshot and re-renders the clock with the snapshot's matchClockMs", async () => {
    render(<GamePage />);
    expect(screen.getByTestId("match-clock").textContent).toBe("180000"); // 3 min default

    // Build a payload with a distinctly different clock so we can verify
    // the page picks it up. We don't need to inspect the board here —
    // HexBoard is mocked — only that the clock changes.
    act(() => {
      fakeSocket.emit("match_state_snapshot", {
        matchId: "m1",
        state: {
          turn: "P1",
          matchClockMs: 120_000,
          matchStartedAt: 0,
          board: [],
        },
        matchClockMs: 120_000,
      });
    });

    await waitFor(() => expect(screen.getByTestId("match-clock").textContent).toBe("120000"));
  });

  it("renders ResultBanner instead of the board when the snapshot carries gameOver", async () => {
    render(<GamePage />);
    expect(screen.queryByTestId("result-banner")).not.toBeInTheDocument();

    act(() => {
      fakeSocket.emit("match_state_snapshot", {
        matchId: "m1",
        state: {
          turn: "P1",
          matchClockMs: 60_000,
          matchStartedAt: 0,
          board: [],
        },
        gameOver: { winner: "P2", reason: "resign" },
        matchClockMs: 60_000,
      });
    });

    await waitFor(() => expect(screen.getByTestId("result-banner")).toBeInTheDocument());
    expect(screen.getByTestId("result-banner").dataset.winner).toBe("P2");
    expect(screen.getByTestId("result-banner").dataset.reason).toBe("resign");
  });
});

describe("GamePage — move_rejected toast", () => {
  beforeEach(() => {
    fakeSocket.removeAllListeners();
    push.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("displays a toast with a humanized message on move_rejected", () => {
    render(<GamePage />);
    act(() => {
      fakeSocket.emit("move_rejected", { reason: "wrong-turn" });
    });
    expect(screen.getByTestId("move-rejected-toast")).toBeInTheDocument();
    expect(screen.getByTestId("move-rejected-toast").textContent).toMatch(/not your turn/i);
  });

  it("uses role='status' (not role='alert') — non-blocking feedback", () => {
    render(<GamePage />);
    act(() => {
      fakeSocket.emit("move_rejected", { reason: "occupied" });
    });
    expect(screen.getByTestId("move-rejected-toast").getAttribute("role")).toBe("status");
  });

  it("auto-dismisses the toast after ~2.5 seconds", () => {
    render(<GamePage />);
    act(() => {
      fakeSocket.emit("move_rejected", { reason: "no-capture" });
    });
    expect(screen.getByTestId("move-rejected-toast")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByTestId("move-rejected-toast")).not.toBeInTheDocument();
  });

  it("clears the toast when a successful move_result arrives", () => {
    render(<GamePage />);
    act(() => {
      fakeSocket.emit("move_rejected", { reason: "wrong-turn" });
    });
    expect(screen.getByTestId("move-rejected-toast")).toBeInTheDocument();

    act(() => {
      fakeSocket.emit("move_result", {
        matchId: "m1",
        by: "P1",
        at: { q: 0, r: 0 },
        captures: [],
        nextState: {
          turn: "P2",
          matchClockMs: 170_000,
          matchStartedAt: 0,
          board: [],
        },
        matchClockMs: 170_000,
      });
    });
    expect(screen.queryByTestId("move-rejected-toast")).not.toBeInTheDocument();
  });

  it("humanizes each MoveRejectedReason to a distinct user-friendly string", () => {
    // Each rejection type maps to a different human-readable message.
    // We use the toast as the visible output rather than calling
    // humanizeMoveRejection directly — verifies the integration point.
    const cases: Array<{
      reason: "wrong-turn" | "occupied" | "out-of-bounds" | "no-capture" | "game-over";
      expected: RegExp;
    }> = [
      { reason: "wrong-turn", expected: /not your turn/i },
      { reason: "occupied", expected: /already taken/i },
      { reason: "out-of-bounds", expected: /outside the board/i },
      { reason: "no-capture", expected: /wouldn't capture/i },
      { reason: "game-over", expected: /match has ended/i },
    ];
    for (const c of cases) {
      // Fresh render per case so previous toast state doesn't leak.
      fakeSocket.removeAllListeners();
      const { unmount } = render(<GamePage />);
      act(() => {
        fakeSocket.emit("move_rejected", { reason: c.reason });
      });
      expect(screen.getByTestId("move-rejected-toast").textContent).toMatch(c.expected);
      unmount();
    }
  });
});

describe("GamePage — game_over handling", () => {
  beforeEach(() => {
    fakeSocket.removeAllListeners();
    push.mockClear();
  });

  it("renders ResultBanner when game_over arrives directly", async () => {
    render(<GamePage />);
    act(() => {
      fakeSocket.emit("game_over", { winner: "P1", reason: "majority" });
    });
    await waitFor(() => expect(screen.getByTestId("result-banner")).toBeInTheDocument());
    expect(screen.getByTestId("result-banner").dataset.winner).toBe("P1");
  });

  it("clears any visible move_rejected toast when game_over arrives", () => {
    render(<GamePage />);
    act(() => {
      fakeSocket.emit("move_rejected", { reason: "wrong-turn" });
    });
    expect(screen.getByTestId("move-rejected-toast")).toBeInTheDocument();
    act(() => {
      fakeSocket.emit("game_over", { winner: "P1", reason: "majority" });
    });
    expect(screen.queryByTestId("move-rejected-toast")).not.toBeInTheDocument();
  });
});
