# Game Engine Specification

## Purpose
Pure, transport-agnostic domain rules for HexArena: axial hex board (radius-4, 61 cells), capture-by-enclosure, turn/shared-clock state machine, end-of-game detection.

## Requirements

### Requirement: Capture Resolution
When a player places a piece, the system MUST resolve captures in ALL six directions simultaneously from the placed cell, not just one.

#### Scenario: Single-direction capture
- GIVEN a legal move that encloses an opponent run in exactly one direction
- WHEN the move is applied
- THEN the enclosed run flips to the moving player
- AND no other direction is affected

#### Scenario: Multi-direction simultaneous capture
- GIVEN a placement that encloses opponent runs in two or more directions at once
- WHEN the move is applied
- THEN the system MUST flip ALL enclosed runs across every qualifying direction in the same move
- AND the move result reports the union of all captured cells

#### Scenario: No enclosure, no capture
- GIVEN a placement with an adjacent opponent run not bounded by an own piece
- WHEN the move is applied
- THEN no cells are captured
- AND the move is rejected as illegal if the move requires at least one capture

### Requirement: Pass Rule
The system MUST allow a player to pass their turn ONLY when that player has zero legal moves AND the opponent has at least one legal move.

#### Scenario: Forced pass
- GIVEN it is player A's turn
- AND `legalMoves(state)` for player A returns an empty set
- AND player B has at least one legal move
- WHEN the server evaluates the turn
- THEN the turn SHALL automatically pass to player B without requiring client input
- AND the game state records the pass (no move applied)

#### Scenario: Reject pass with legal moves available
- GIVEN player A has at least one legal move
- WHEN a pass is attempted for player A
- THEN the system MUST reject the pass

### Requirement: Game End Detection
The system MUST end the game when EITHER (a) both players have zero legal moves in succession, OR (b) the board is full (no empty cells remain), OR (c) the shared match clock reaches zero (see "Clock Expiry").

#### Scenario: Both players stuck
- GIVEN player A has no legal moves and passes
- AND player B, on their subsequent turn, also has no legal moves
- WHEN `checkEnd(state)` is evaluated
- THEN the game MUST end with `over: true`

#### Scenario: Board full
- GIVEN all 61 cells are occupied
- WHEN `checkEnd(state)` is evaluated after the placing move
- THEN the game MUST end with `over: true`
- AND no further moves are accepted

### Requirement: Win Determination and Tie-Break
The system MUST declare the winner as the player controlling more cells at game end. When both players control an EQUAL number of cells, the system MUST declare the match a DRAW. This rule is the SAME regardless of which end condition triggered game end (board full, both players stuck, or shared clock expiry).

#### Scenario: Clear majority winner
- GIVEN game end is reached
- AND player A controls 33 cells, player B controls 28 cells
- WHEN `checkEnd(state)` computes the result
- THEN player A SHALL be declared winner
- AND `reason` SHALL be `"majority"`

#### Scenario: Equal cell count draw
- GIVEN game end is reached
- AND both players control the same number of cells
- WHEN `checkEnd(state)` computes the result
- THEN the system MUST return `winner: null, reason: "draw"`
- AND no `ArenaSettlement.settle()` on-chain call SHALL be triggered by a draw result; instead, each Arena player is refunded their stake minus the house rake via a ledger-only credit (see arena-settlement spec, "Draw Refund Minus House Rake"). This settlement path is keyed on `winner === null`, not on the `reason` string — a draw reached via clock expiry settles identically to a draw reached via board-full.

### Requirement: Clock Expiry
The system MUST maintain a SINGLE shared match clock (not one clock per player), initialized to a minimum of 180000ms (3 minutes) at match start, decrementing in real time from match start regardless of whose turn it is. When the shared match clock reaches zero, the system MUST end the match immediately and resolve the winner using the SAME majority-of-cells rule as any other end-of-game condition — NOT an automatic loss for either player. (Merged from the shared-match-timer change, 2026-07-03; replaces the original per-player Blitz clock, under which whoever held the turn when their own clock hit zero lost automatically regardless of board control.)

#### Scenario: Shared clock ticks regardless of turn
- GIVEN a match is active with `matchClockMs = 120000`
- AND player A is mid-turn deliberation (no move submitted yet)
- WHEN 1000ms of real time elapses
- THEN `matchClockMs` MUST decrement by 1000ms
- AND this MUST happen whether it is player A's or player B's turn — the clock is NOT paused/resumed per turn

#### Scenario: Clock expiry triggers majority scoring, not auto-loss
- GIVEN `matchClockMs` reaches 0
- AND player A controls 35 cells, player B controls 20 cells (6 cells still empty)
- WHEN the server evaluates the expired clock
- THEN the match MUST end immediately
- AND the winner MUST be determined by cell majority (player A, in this example) exactly as in the "Win Determination and Tie-Break" requirement
- AND `reason` SHALL be `"timeout"` (retained as the reason label for observability) but the WINNER determination logic MUST be identical to the board-full/both-stuck majority path — no player automatically loses solely because the clock expired

#### Scenario: Clock expiry with equal cell count is a draw
- GIVEN `matchClockMs` reaches 0
- AND both players control an equal number of cells
- WHEN the server evaluates the expired clock
- THEN the match MUST end with `winner: null, reason: "timeout"`, settled identically to any other draw (see "Win Determination and Tie-Break")

#### Scenario: Minimum clock floor
- GIVEN a match is created
- WHEN the initial `matchClockMs` is set
- THEN it MUST be no less than 180000ms (3 minutes)
