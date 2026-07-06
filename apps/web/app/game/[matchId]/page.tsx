"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  createGame,
  deserializeGameState,
  type Axial,
  type GameState,
  type PlayerId,
} from "@hexarena/shared/domain/board";
import type {
  GameOverPayload,
  MatchSnapshotPayload,
  MoveRejectedReason,
} from "@hexarena/shared/protocol";
import { BOT_USER_ID } from "@hexarena/shared/domain/bot";
import { HexBoard, PIECE_COLOR, PIECE_COLOR_NAME } from "../../../components/HexBoard";
import { MatchClock } from "../../../components/MatchClock";
import { PlayerStatusRow } from "../../../components/PlayerStatusRow";
import { ResultBanner } from "../../../components/ResultBanner";
import { MoveRejectedToast, humanizeMoveRejection } from "../../../components/MoveRejectedToast";
import { getSocket } from "../../../lib/socketSingleton";
import { countPieces } from "../../../lib/captureCount";

/**
 * In-game board screen (design.md wireframe "3. In-Game Board").
 * Server-authoritative: renders whatever `GameState` the server last
 * broadcast, and only sends move intent — never applies moves locally.
 *
 * Brief-disconnect handling (2026-07-06 bug fix): on mount the page
 * emits `resume` and listens for `match_state_snapshot`. Without the
 * snapshot, the page renders `useState(createGame())` (empty initial
 * state) while the server has already processed moves — every click
 * would be rejected with `move_rejected` and the rejection was
 * invisible, so the page looked frozen.
 *
 * `move_rejected` is now surfaced as a toast (MoveRejectedToast) so the
 * user understands why their click didn't register. The toast clears
 * automatically when a successful `move_result` arrives.
 */
export default function GamePage() {
  const params = useParams<{ matchId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const matchId = params.matchId;
  const selfColor = (searchParams.get("color") as PlayerId | null) ?? "P1";
  const opponentId = searchParams.get("opponent");
  const opponentLabel =
    opponentId === BOT_USER_ID
      ? "HexArena Bot"
      : opponentId
        ? `Opponent #${opponentId.slice(0, 4).toUpperCase()}`
        : "Opponent";

  const [state, setState] = useState<GameState>(createGame());
  const [gameOver, setGameOver] = useState<GameOverPayload | null>(null);
  const [rejection, setRejection] = useState<{ reason: MoveRejectedReason; ts: number } | null>(
    null,
  );

  const dismissRejection = useCallback(() => setRejection(null), []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    function onMoveResult(payload: { nextState: Parameters<typeof deserializeGameState>[0] }) {
      setState(deserializeGameState(payload.nextState));
      // A successful move means the rejection toast is stale — clear it
      // so it doesn't linger if the user tried a bad move then a good one.
      setRejection(null);
    }
    function onClockTick(payload: { matchClockMs: number }) {
      setState((prev) => ({ ...prev, matchClockMs: payload.matchClockMs }));
    }
    function onGameOver(payload: GameOverPayload) {
      setGameOver(payload);
      setRejection(null);
    }
    function onSnapshot(payload: MatchSnapshotPayload) {
      // The server's authoritative view of the match — overwrite whatever
      // the client had (could be the empty initial state after a reconnect,
      // or a state that diverged while the WebView was suspended).
      setState(deserializeGameState(payload.state));
      if (payload.gameOver) {
        setGameOver(payload.gameOver);
      }
    }
    function onMoveRejected(payload: { reason: MoveRejectedReason }) {
      setRejection({ reason: payload.reason, ts: Date.now() });
    }

    socket.on("move_result", onMoveResult);
    socket.on("clock_tick", onClockTick);
    socket.on("game_over", onGameOver);
    socket.on("match_state_snapshot", onSnapshot);
    socket.on("move_rejected", onMoveRejected);
    socket.emit("resume", { matchId });

    return () => {
      socket.off("move_result", onMoveResult);
      socket.off("clock_tick", onClockTick);
      socket.off("game_over", onGameOver);
      socket.off("match_state_snapshot", onSnapshot);
      socket.off("move_rejected", onMoveRejected);
    };
  }, [matchId]);

  function handleCellClick(at: Axial) {
    getSocket().emit("make_move", { matchId, at });
  }

  function handleResign() {
    getSocket().emit("resign", { matchId });
  }

  if (gameOver) {
    return (
      <main className="mx-auto flex max-w-md flex-col px-4 pt-6">
        <ResultBanner result={gameOver} selfPlayer={selfColor} />
        <button
          type="button"
          onClick={() => router.push("/matchmaking")}
          className="mt-4 w-full rounded-xl bg-arena-magenta py-3 text-sm font-bold uppercase text-white shadow-neonMagenta"
        >
          Rematch
        </button>
      </main>
    );
  }

  const opponentColor: PlayerId = selfColor === "P1" ? "P2" : "P1";
  const captureCounts = countPieces(state.board);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-6">
      <MatchClock matchClockMs={state.matchClockMs} />
      <PlayerStatusRow
        label={opponentLabel}
        captureCount={captureCounts[opponentColor]}
        isTurn={state.turn === opponentColor}
        isSelf={false}
        pieceColorClassName={PIECE_COLOR[opponentColor]}
      />
      <div className="py-2">
        <HexBoard state={state} onCellClick={handleCellClick} />
      </div>
      <PlayerStatusRow
        label={`You (${PIECE_COLOR_NAME[selfColor]})`}
        captureCount={captureCounts[selfColor]}
        isTurn={state.turn === selfColor}
        isSelf
        pieceColorClassName={PIECE_COLOR[selfColor]}
      />
      <button
        type="button"
        onClick={handleResign}
        className="mt-2 w-full rounded-xl border border-arena-border py-2 text-sm font-bold uppercase text-slate-400"
      >
        Resign
      </button>
      <MoveRejectedToast
        message={rejection ? humanizeMoveRejection(rejection.reason) : null}
        onDismiss={dismissRejection}
      />
    </main>
  );
}
