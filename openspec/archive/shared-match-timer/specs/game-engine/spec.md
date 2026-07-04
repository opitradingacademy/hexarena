# Game Engine Specification — Delta (shared-match-timer)

## MODIFIED Requirements

### Requirement: Clock Expiry
The system MUST maintain a SINGLE shared match clock (not one clock per player), initialized to a minimum of 180000ms (3 minutes) at match start, decrementing in real time from match start regardless of whose turn it is. When the shared match clock reaches zero, the system MUST end the match immediately and resolve the winner using the SAME majority-of-cells rule as any other end-of-game condition (see "Win Determination and Tie-Break") — NOT an automatic loss for either player.

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
- THEN the match MUST end with `winner: null, reason: "draw"` (or `"timeout"` with a null winner — exact reason string to be finalized in design.md), using the same tie-break rule as any other draw

#### Scenario: Minimum clock floor
- GIVEN a match is created
- WHEN the initial `matchClockMs` is set
- THEN it MUST be no less than 180000ms (3 minutes)

## REMOVED Requirements

### Requirement: Per-player clock ownership
**Reason**: Replaced by a single shared match clock (see MODIFIED "Clock Expiry" above). The prior model tracked `clocks: Record<PlayerId, number>` with independent countdowns per player, paused/resumed based on `state.turn`. This created a sudden-death dynamic where a player who moved quickly could force a win purely by running out the opponent's clock, independent of board control — undesirable for Arena mode with real money at stake.
**Migration**: `GameState.clocks: Record<PlayerId, number>` is replaced by `GameState.matchClockMs: number`. Any code reading `state.clocks[player]` must be updated to read the single `matchClockMs` value instead.
