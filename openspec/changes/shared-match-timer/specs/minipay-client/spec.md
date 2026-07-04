# MiniPay Client Specification — Delta (shared-match-timer)

## MODIFIED Requirements

### Requirement: In-Game Clock Display
The client MUST render the single shared match clock, not one clock per player.

#### Scenario: Single shared clock rendered
- GIVEN a match is active
- WHEN the client receives `clock_tick{matchClockMs}` or any payload carrying `matchClockMs`
- THEN the client MUST render exactly one countdown showing `matchClockMs`
- AND MUST NOT render two separate per-player countdowns

## ADDED Requirements

### Requirement: Live Captured-Piece Count
The client MUST display a live count of pieces currently controlled by each player on the board, updated after every move.

#### Scenario: Capture count updates after a move
- GIVEN a move is applied that captures 4 opponent cells
- WHEN the client receives the resulting `nextState`
- THEN the client MUST recompute and display each player's cell count derived from the board state
- AND the displayed counts MUST reflect the new totals without requiring a page reload

#### Scenario: Capture counts visible at match start
- GIVEN a match has just started (initial layout: 3 cells per player)
- WHEN the game screen renders
- THEN the client MUST display 3-3 as the initial captured-piece count for both players
