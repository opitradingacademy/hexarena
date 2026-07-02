"use client";

import { useState } from "react";
import { createGame, type Axial } from "@hexarena/shared/domain/board";
import { HexBoard } from "../../../components/HexBoard";
import { PlayerClock } from "../../../components/PlayerClock";

/**
 * In-game board screen (design.md wireframe "3. In-Game Board").
 * Uses the pure domain engine (packages/shared) for local rendering; the
 * server-authoritative move flow over Socket.IO connects in PR5 e2e.
 */
export default function GamePage() {
  const [state] = useState(createGame());

  function handleCellClick(_at: Axial) {
    // make_move({ matchId, at }) wired against a live server connection in PR5.
  }

  return (
    <main>
      <PlayerClock label="Opponent" remainingMs={state.clocks.P2} isTurn={state.turn === "P2"} />
      <HexBoard state={state} onCellClick={handleCellClick} />
      <PlayerClock label="You" remainingMs={state.clocks.P1} isTurn={state.turn === "P1"} />
      <button type="button">Resign</button>
    </main>
  );
}
