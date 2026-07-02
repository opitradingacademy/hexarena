"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createGame, deserializeGameState, type Axial, type GameState, type PlayerId } from "@hexarena/shared/domain/board";
import type { GameOverPayload } from "@hexarena/shared/protocol";
import { HexBoard, PIECE_COLOR, PIECE_COLOR_NAME } from "../../../components/HexBoard";
import { PlayerClock } from "../../../components/PlayerClock";
import { ResultBanner } from "../../../components/ResultBanner";
import { getSocket } from "../../../lib/socketSingleton";

/**
 * In-game board screen (design.md wireframe "3. In-Game Board").
 * Server-authoritative: renders whatever `GameState` the server last
 * broadcast, and only sends move intent — never applies moves locally.
 */
export default function GamePage() {
  const params = useParams<{ matchId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const matchId = params.matchId;
  const selfColor = (searchParams.get("color") as PlayerId | null) ?? "P1";
  const opponentId = searchParams.get("opponent");
  const opponentLabel = opponentId ? `Opponent #${opponentId.slice(0, 4).toUpperCase()}` : "Opponent";

  const [state, setState] = useState<GameState>(createGame());
  const [gameOver, setGameOver] = useState<GameOverPayload | null>(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    function onMoveResult(payload: { nextState: Parameters<typeof deserializeGameState>[0] }) {
      setState(deserializeGameState(payload.nextState));
    }
    function onGameOver(payload: GameOverPayload) {
      setGameOver(payload);
    }

    socket.on("move_result", onMoveResult);
    socket.on("game_over", onGameOver);
    socket.emit("resume", { matchId });

    return () => {
      socket.off("move_result", onMoveResult);
      socket.off("game_over", onGameOver);
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

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-6">
      <PlayerClock
        label={opponentLabel}
        remainingMs={state.clocks[opponentColor]}
        isTurn={state.turn === opponentColor}
        isSelf={false}
        pieceColorClassName={PIECE_COLOR[opponentColor]}
      />
      <div className="overflow-x-auto py-2">
        <HexBoard state={state} onCellClick={handleCellClick} />
      </div>
      <PlayerClock
        label={`You (${PIECE_COLOR_NAME[selfColor]})`}
        remainingMs={state.clocks[selfColor]}
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
    </main>
  );
}
