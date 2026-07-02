# Realtime Protocol Specification

## Purpose
WebSocket (Socket.IO) wire contract for matchmaking, moves, disconnect/reconnect, and game-over resolution. Server is sole authority.

## Requirements

### Requirement: Queue Join
The system MUST place a client into a matchmaking queue for the requested mode and, for Arena, MUST verify available balance before queuing.

#### Scenario: Successful queue join
- GIVEN a connected client sends `join_queue{mode: CASUAL}`
- WHEN the server processes the request
- THEN the server MUST respond with `queue_joined{}`

#### Scenario: Arena join with insufficient balance
- GIVEN a client sends `join_queue{mode: ARENA, stake: 0.50}` with balance < 0.50
- WHEN the server validates the request
- THEN the server MUST respond with `error{code: "INSUFFICIENT_BALANCE"}`
- AND MUST NOT enqueue the client

### Requirement: Match Found
When two queued clients are paired, the system MUST notify both with symmetric match data.

#### Scenario: Pairing emits match_found to both
- GIVEN two clients are compatible in the same queue (mode/stake)
- WHEN the matchmaker pairs them
- THEN both clients MUST receive `match_found{matchId, opponent, color, initialState, clocks}`
- AND each client's `color` MUST differ

### Requirement: Move Validation
The system MUST validate every `make_move` against the domain engine before broadcasting a result.

#### Scenario: Valid move broadcast
- GIVEN it is the sender's turn and the target cell yields a legal move
- WHEN `make_move{matchId, at}` is received
- THEN the server MUST broadcast `move_result{matchId, by, at, captures, nextState, clocks}` to the match room

#### Scenario: Invalid move rejected
- GIVEN the move is illegal (wrong turn, occupied cell, no valid enclosure)
- WHEN `make_move` is received
- THEN the server MUST respond to the sender only with `move_rejected{reason}`
- AND MUST NOT alter game state or broadcast to the opponent

### Requirement: Disconnection Grace Window
When a player disconnects mid-match, the system MUST hold the match open for a grace period of exactly 30000ms (`graceMs = 30000`) during which the player MAY reconnect and resume. This value is fixed for MVP (confirmed by product owner 2026-07-01), not configurable per-match.

#### Scenario: Reconnect within grace window
- GIVEN player A disconnects and the opponent receives `opponent_disconnected{graceMs}`
- WHEN player A reconnects and sends `resume{matchId}` before `graceMs` elapses
- THEN the server MUST restore player A's session to the match
- AND MUST broadcast `opponent_reconnected{}` to the opponent
- AND the match clock MUST continue from where it was

#### Scenario: Abandonment outside grace window
- GIVEN player A remains disconnected past `graceMs`
- WHEN the grace timer expires
- THEN the server MUST end the match with the opponent as winner
- AND MUST emit `game_over{winner: opponent, reason: "abandon"}`

### Requirement: Game Over Delivery
The system MUST notify both clients of game end with a reason and, for Arena matches, settlement status.

#### Scenario: Casual game over
- GIVEN a Casual match ends by any end condition
- WHEN the server finalizes the match
- THEN both clients MUST receive `game_over{winner, reason}` with no `arena` field

#### Scenario: Arena game over pending settlement
- GIVEN an Arena match ends and on-chain settlement is queued but not yet confirmed
- WHEN the server finalizes the match
- THEN both clients MUST receive `game_over{winner, reason, arena: {prizeUSD, settleTxPending: true}}`
- AND the client MUST NOT block gameplay UI on settlement confirmation
