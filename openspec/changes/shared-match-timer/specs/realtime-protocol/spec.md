# Realtime Protocol Specification — Delta (shared-match-timer)

## MODIFIED Requirements

### Requirement: Match Found
When two queued clients are paired, the system MUST notify both with symmetric match data, including the single shared match clock (not per-player clocks).

#### Scenario: Pairing emits match_found to both
- GIVEN two clients are compatible in the same queue (mode/stake)
- WHEN the matchmaker pairs them
- THEN both clients MUST receive `match_found{matchId, opponent, color, initialState, matchClockMs}`
- AND each client's `color` MUST differ
- AND `matchClockMs` MUST be identical for both clients (there is only one clock)

### Requirement: Move Validation
The system MUST validate every `make_move` against the domain engine before broadcasting a result. The broadcast payload reports the single shared match clock, not per-player clocks.

#### Scenario: Valid move broadcast
- GIVEN it is the sender's turn and the target cell yields a legal move
- WHEN `make_move{matchId, at}` is received
- THEN the server MUST broadcast `move_result{matchId, by, at, captures, nextState, matchClockMs}` to the match room

#### Scenario: Invalid move rejected
- GIVEN the move is illegal (wrong turn, occupied cell, no valid enclosure)
- WHEN `make_move` is received
- THEN the server MUST respond to the sender only with `move_rejected{reason}`
- AND MUST NOT alter game state or broadcast to the opponent

### Requirement: Game Over Delivery
The system MUST notify both clients of game end with a reason and, for Arena matches, settlement status. This applies uniformly whether the match ended by board-full, both-stuck, or shared-clock expiry — the payload shape does not change based on end cause.

#### Scenario: Casual game over
- GIVEN a Casual match ends by any end condition (including shared clock expiry)
- WHEN the server finalizes the match
- THEN both clients MUST receive `game_over{winner, reason}` with no `arena` field

#### Scenario: Arena game over pending settlement
- GIVEN an Arena match ends and on-chain settlement is queued but not yet confirmed
- WHEN the server finalizes the match
- THEN both clients MUST receive `game_over{winner, reason, arena: {prizeUSD, settleTxPending: true}}`
- AND the client MUST NOT block gameplay UI on settlement confirmation

## ADDED Requirements

### Requirement: Shared Clock Tick Broadcast
The system MUST broadcast the single shared match clock value to both clients approximately once per second while the match is active.

#### Scenario: Periodic clock tick
- GIVEN a match is active
- WHEN 1000ms of real time elapses
- THEN the server MUST emit `clock_tick{matchClockMs}` to both clients in the match room
