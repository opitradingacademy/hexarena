# Arena Settlement Specification

## Purpose
Custody, ledger invariants, and on-chain payout rules for Arena stake matches. Backend ledger is source of truth for the hot path; `ArenaSettlement` Mainnet contract executes verifiable winner payouts.

## Requirements

### Requirement: Non-Negative Balance
The system MUST NOT allow any user's ledger balance (sum of `ledger_entries.delta`) to go negative at any point.

#### Scenario: Stake hold blocked by insufficient balance
- GIVEN a user's available balance is $0.05
- WHEN the user attempts `join_queue{mode: ARENA, stake: 0.10}`
- THEN the system MUST reject the join with an insufficient-balance error
- AND no HOLD entry is written

#### Scenario: Hold succeeds within balance
- GIVEN a user's available balance is $1.00
- WHEN the user joins an Arena queue with stake $0.50
- THEN the system MUST write a HOLD entry of -$0.50
- AND resulting balance MUST remain ≥ 0

### Requirement: Unique Deposit Crediting
The system MUST credit a deposit exactly once per on-chain transaction hash.

#### Scenario: Duplicate tx_hash rejected
- GIVEN a deposit with `tx_hash` X has already been credited
- WHEN the indexer processes an event referencing `tx_hash` X again
- THEN the system MUST NOT create a second credit
- AND the unique constraint on `deposits.tx_hash` MUST prevent duplicate insert

### Requirement: Atomic Hold/Release
Hold and release operations for a match's stake MUST be executed as a single atomic database transaction per user.

#### Scenario: Hold-then-release on game_over
- GIVEN both players have an active HOLD for match M
- WHEN the match ends and stakes are resolved
- THEN the losing player's HOLD MUST be debited and the winner's balance credited within one DB transaction
- AND a partial state (e.g., debit without credit) MUST NOT be observable

#### Scenario: Transaction failure leaves no partial write
- GIVEN a DB error occurs mid-settlement
- WHEN the transaction is rolled back
- THEN no ledger_entries for that resolution MUST persist

### Requirement: House Rake on Payout
The system MUST deduct a house rake of 20% (0.02 per 0.10 staked) from the total prize pool before crediting the winner. The winner MUST receive 80% of the combined stakes (`sum(stakes) * 0.8`).

#### Scenario: Standard win payout with rake
- GIVEN two players each staked $0.10 (pool = $0.20)
- WHEN the match ends with a decisive winner
- THEN the system MUST compute payout as `$0.20 * 0.8 = $0.16`
- AND the house rake of `$0.20 * 0.2 = $0.04` MUST be retained (not disbursed to either player)
- AND `ArenaSettlement.settle(matchId, winner, amount)` MUST be called with `amount = $0.16`

### Requirement: Abandon/Disconnect Grace Period
The system MUST allow a disconnected player a grace period of exactly 30 seconds to reconnect before the match is forfeited to the opponent.

#### Scenario: Reconnect within grace period
- GIVEN a player disconnects mid-match
- WHEN that player reconnects within 30 seconds
- THEN the match MUST resume with clock and board state intact
- AND no forfeiture MUST occur

#### Scenario: Grace period expires
- GIVEN a player disconnects mid-match
- WHEN 30 seconds elapse without reconnection
- THEN the system MUST forfeit the match to the opponent
- AND, for Arena matches, settlement MUST proceed per the House Rake requirement above (opponent is the winner)

### Requirement: Draw Refund Minus House Rake
The system MUST refund each player their original stake minus their proportional share of the house rake when an Arena match ends in a draw. The house still collects its 20% cut even on a draw.

#### Scenario: Draw refund with rake deducted
- GIVEN two players each staked $0.10 (pool = $0.20) and the match ends in a tie
- WHEN settlement is processed
- THEN each player MUST be refunded `$0.10 * 0.8 = $0.08`
- AND the house MUST retain `$0.20 * 0.2 = $0.04` total (same rake as a decisive win)
- AND this is a ledger-only credit; no on-chain `ArenaSettlement.settle()` call is required unless the product later requires an on-chain record of draw payouts

### Requirement: Full Refund on Server-Error Void
The system MUST refund each player's full original stake (no rake deducted) when a match cannot reach a decisive settlement due to a server error or a mid-match void unrelated to gameplay outcome.

#### Scenario: Server-error void refund
- GIVEN an Arena match is left in an indeterminate state due to a server error
- WHEN the match is marked VOID
- THEN each player MUST be refunded their original stake in full via a ledger credit
- AND no `ArenaSettlement.settle()` call MUST be made for a fully-refunded match (refund is a backend-ledger-only operation, not on-chain)

### Requirement: Settlement Idempotency Per Match
The system MUST settle a given match on-chain AT MOST ONCE, keyed by `matchId`.

#### Scenario: First settlement succeeds
- GIVEN match M has `state: FINISHED` and `settle_tx IS NULL`
- WHEN the backend calls `ArenaSettlement.settle(matchId, winner, amount)`
- THEN the contract MUST mark `matchId` as settled and emit a payout event
- AND `matches.settle_tx` MUST be recorded

#### Scenario: Duplicate settlement attempt rejected
- GIVEN match M has already been settled (`settle_tx` is set)
- WHEN a second `settle()` call is attempted for the same `matchId` (retry, race, or replay)
- THEN the contract MUST revert
- AND no second payout MUST be disbursed

### Requirement: Operator-Only Settlement Access
The `settle()` function MUST be callable only by the designated backend operator address.

#### Scenario: Non-operator call rejected
- GIVEN a caller is not the configured operator
- WHEN that caller invokes `settle()`
- THEN the contract MUST revert with an authorization error

### Requirement: Admin Pause and Withdraw
The contract owner MUST be able to pause settlement and withdraw undistributed funds as an escape hatch.

#### Scenario: Paused settlement blocked
- GIVEN the contract is paused by the owner
- WHEN the operator calls `settle()`
- THEN the call MUST revert

## Resolved Decisions (previously open, confirmed by product owner 2026-07-01)
- House rake: 20% of total pool (0.02 per 0.10 staked) on every decisive win.
- Abandon/disconnect grace period: 30 seconds.
- Server-error void: full refund, no rake.
- Draw: refund minus house rake (same 20% cut as a win).
