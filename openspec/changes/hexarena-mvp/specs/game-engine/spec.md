# Game Engine Specification

## Purpose
Pure, transport-agnostic domain rules for HexArena: axial hex board (radius-4, 61 cells), capture-by-enclosure, turn/clock state machine, end-of-game detection.

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
The system MUST end the game when EITHER (a) both players have zero legal moves in succession, OR (b) the board is full (no empty cells remain).

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
The system MUST declare the winner as the player controlling more cells at game end. When both players control an EQUAL number of cells, the system MUST declare the match a DRAW.

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
- AND no `ArenaSettlement.settle()` on-chain call SHALL be triggered by a draw result; instead, each Arena player is refunded their stake minus the house rake via a ledger-only credit (see arena-settlement spec, "Draw Refund Minus House Rake")

### Requirement: Clock Expiry
The system MUST end the game in favor of the opponent when a player's Blitz clock reaches zero.

#### Scenario: Timeout loss
- GIVEN player A's clock reaches 0 while it is player A's turn
- WHEN the server evaluates clock state
- THEN player B SHALL be declared winner
- AND `reason` SHALL be `"timeout"`
