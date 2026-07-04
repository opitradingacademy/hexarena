# MiniPay Client Specification

## Purpose
User-facing rules for MiniPay compatibility: environment detection, fee/crypto-free copy, bundle size, and supported stable assets.

## Requirements

### Requirement: MiniPay Environment Detection
The client MUST detect whether it is running inside the MiniPay in-app browser and branch wallet UX accordingly.

#### Scenario: Running inside MiniPay
- GIVEN the app loads inside the MiniPay webview
- WHEN `isMiniPay()` is evaluated
- THEN it MUST return `true`
- AND the client MUST use the injected MiniPay provider without prompting for external wallet connection

#### Scenario: Running outside MiniPay
- GIVEN the app loads in a standard browser
- WHEN `isMiniPay()` is evaluated
- THEN it MUST return `false`
- AND the client MAY show a "use in MiniPay" notice (no external connector required for MVP)

### Requirement: Crypto/Gas-Free Copy
The client MUST NOT surface raw crypto/gas terminology or on-chain addresses as primary UI text anywhere a user sees balances, fees, or identities.

#### Scenario: Fee copy uses network-fee language
- GIVEN a screen displays a transaction cost
- WHEN the copy is rendered
- THEN the text MUST use "network fee" (or localized equivalent) and MUST NOT contain "gas" or "gas fee"

#### Scenario: No raw token/address exposure
- GIVEN a screen displays balance, deposit, or identity information
- WHEN the copy is rendered
- THEN it MUST NOT show "CELO", a `0x`-prefixed address, or a token ticker as the primary label
- AND balances MUST be denominated in USD

### Requirement: Bundle Size Budget
The client's shipped JavaScript bundle MUST remain under 2MB to load reliably inside MiniPay's constrained webview.

#### Scenario: Bundle under budget at build
- GIVEN a production build is generated
- WHEN the bundle analyzer measures total JS payload
- THEN the measured size MUST be less than 2MB
- AND the build MUST fail the release gate if exceeded

### Requirement: Supported Stable Assets Only
The client MUST restrict user-facing balances and transactions to USDT, USDC, and USDm (cUSD); CELO MUST never be user-visible.

#### Scenario: Deposit flow limited to supported stables
- GIVEN a user opens the deposit screen
- WHEN available asset options are rendered
- THEN only USDT, USDC, and USDm MUST be offered
- AND CELO MUST NOT appear as a selectable or displayed asset

### Requirement: In-Game Clock Display
The client MUST render the single shared match clock, not one clock per player (see game-engine spec "Clock Expiry" — shared-match-timer change, merged 2026-07-03).

#### Scenario: Single shared clock rendered
- GIVEN a match is active
- WHEN the client receives `clock_tick{matchClockMs}` or any payload carrying `matchClockMs`
- THEN the client MUST render exactly one countdown showing `matchClockMs`
- AND MUST NOT render two separate per-player countdowns

### Requirement: Live Captured-Piece Count
The client MUST display a live count of pieces currently controlled by each player on the board, updated after every move (shared-match-timer change, merged 2026-07-03).

#### Scenario: Capture count updates after a move
- GIVEN a move is applied that captures 4 opponent cells
- WHEN the client receives the resulting `nextState`
- THEN the client MUST recompute and display each player's cell count derived from the board state
- AND the displayed counts MUST reflect the new totals without requiring a page reload

#### Scenario: Capture counts visible at match start
- GIVEN a match has just started (initial layout: 3 cells per player)
- WHEN the game screen renders
- THEN the client MUST display 3-3 as the initial captured-piece count for both players

## Open Questions (product decisions — not resolved by this spec)
- Whether talent.app registration flow requires any additional in-app copy or disclosure.
