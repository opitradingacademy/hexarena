# Design: hexarena-mvp

## Technical Approach
Monorepo (pnpm workspaces). Game authority is a PURE domain module in `packages/shared` (no I/O), driven by a thin Socket.IO application layer in `apps/server`. Arena money uses backend custody + an internal ledger as source of truth for the hot path; a single Celo Mainnet `ArenaSettlement` contract performs verifiable winner PAYOUTS. Deposits and payouts touch chain; the game loop never does.

## Architecture Decisions

### D1: ArenaSettlement funding & access control
| Option | Tradeoff | Decision |
|--------|----------|----------|
| (a) Pre-funded prize float, backend `settle()` releases | Simplest, gas paid once at top-up, backend must keep float funded | **CHOSEN (MVP)** |
| (b) Contract pulls from external treasury on settle | Extra approval/allowance plumbing, more surface | Rejected — over-engineered for MVP |
**Access control**: `settle()` is `onlyOperator` (single backend signer). Admin functions (`fund`, `withdraw`, `pause`) `onlyOwner`. MVP accepts SINGLE-SIGNER trust: the operator can settle arbitrarily — documented operator-trust risk; v2 → multisig/timelock owner. **Idempotency**: `mapping(bytes32 matchId => bool settled)`; `settle` reverts if already settled → no double-pay. Reentrancy: `nonReentrant` + checks-effects-interactions (mark settled before transfer). `pause()` halts settlement; `withdraw` is owner-only escape hatch.

### D2: Custody source of truth
On-chain balance is NOT queried in the game loop. Internal ledger (Postgres) is authoritative for available balance during matchmaking/stake-hold. On-chain contract only mirrors deposits (via events) and executes payouts. Rationale: Blitz pacing needs sub-second stake checks.

### D3: Domain / application boundary
Pure domain in `packages/shared` exports functions only — NO Socket.IO, NO timers, NO DB. Application layer (`apps/server`) owns transport, clock, sessions, ledger, chain calls. Interface = ports (below). Rationale: matches hexagonal preference, fully unit-testable, transport-swappable.

## Data Flow

Deposit:
    User → (on-chain transfer to backend wallet / liquidation address) → chain event
      → server indexer → ledger.credit(userId, amount) → internal balance

Arena match:
    join_queue(stake) → server checks ledger.available ≥ stake → HOLD stake (both players)
      → match runs 100% off-chain via domain engine
      → game_over → ledger.debit losers' hold, credit winner (net)
      → server signs ArenaSettlement.settle(matchId, winnerAddr, prize) → on-chain payout event
      → ledger marks match SETTLED

Move (hot path, no chain, no DB write on critical path):
    make_move → app validates via domain.applyMove(state,move)
      → new state + captures → move_result broadcast to room → clock switch

## Ledger Schema (Postgres)
- `users(id, phone_or_alias, wallet_address, created_at)`
- `deposits(id, user_id, tx_hash UNIQUE, token, amount, credited_at)` — tx_hash unique = no double-credit
- `ledger_entries(id, user_id, match_id NULL, delta, kind[DEPOSIT|HOLD|RELEASE|PAYOUT|REFUND], created_at)` — balance = SUM(delta); append-only
- `matches(id, mode[CASUAL|ARENA], p1, p2, stake, winner NULL, state[QUEUED|ACTIVE|FINISHED|SETTLED|VOID], settle_tx NULL, created_at, ended_at)`
**Invariants**: balance = Σ delta per user MUST be ≥ 0 (enforced in tx before HOLD); one HOLD per (user,match); settlement only when match.state=FINISHED and settle_tx IS NULL; DB tx wraps hold/release atomically.

## Interfaces / Contracts

Domain ports (`packages/shared/domain`):
```ts
type Axial = { q: number; r: number };
type GameState = { board: Map<string,PlayerId|null>; turn: PlayerId; clocks: Record<PlayerId,number>; status };
function createGame(seed?): GameState;
function legalMoves(s: GameState): Axial[];
function applyMove(s: GameState, p: PlayerId, at: Axial): { state: GameState; captures: Axial[] } | { error };
function checkEnd(s: GameState): { over: boolean; winner?: PlayerId; reason };
```
Clock/session/ledger/chain are application-layer ports (interfaces) injected into handlers — domain stays pure.

## WebSocket Wire Protocol (`packages/shared/protocol`)
C→S: `join_queue{mode, stake?}`, `cancel_queue{}`, `make_move{matchId, at:Axial}`, `resign{matchId}`, `resume{matchId}` (reconnect).
S→C: `queue_joined{}`, `match_found{matchId, opponent, color, initialState, clocks}`, `move_result{matchId, by, at, captures, nextState, clocks}`, `move_rejected{reason}`, `clock_tick{clocks}`, `opponent_disconnected{graceMs}`, `opponent_reconnected{}`, `game_over{winner, reason, arena?:{prizeUSD, settleTxPending}}`, `error{code,msg}`.
Server is authority: client sends intent, server validates via domain and broadcasts resulting state.

## Folder Structure
```
apps/web/        Next.js Mini App (MiniPay), viem, board renderer (lazy)
apps/server/     Node + Socket.IO; app layer: matchmaking, clock, sessions, ledger, chain adapter (viem signer)
packages/shared/ domain/(board math, engine, pure) · protocol/(WS event types) · chain/(ABI + verified addresses)
packages/contracts/  Solidity ArenaSettlement.sol + Foundry/Hardhat, deploy scripts, tests
```
Contract lives in `packages/contracts` (own toolchain); ABI + Mainnet address published into `packages/shared/chain` post-deploy.

## Testing Strategy
| Layer | What | Approach |
|-------|------|----------|
| Unit | domain: capture, legalMoves, win detection, clock expiry | pure fns, no mocks (STRICT TDD) |
| Unit | ledger invariants: no negative, no double-credit, hold atomicity | in-memory/test DB |
| Contract | settle idempotency, onlyOperator, pause, reentrancy | Foundry tests |
| Integration | matchmaking → move → game_over → settle | Socket.IO test client + testnet/fork |
| E2E | MiniPay copy rules, <2MB bundle, deposit→play→payout | manual + bundle-analyzer gate |

## Wireframe Specs (for OpenPencil — Markdown, manual replication)

### 1. Dashboard (neon/futuristic, ref: gamearenahq dashboard)
- Layout: dark bg, neon-cyan/magenta accents, top nav (logo left, wallet widget right).
- Wallet widget: shows balance in **USD** (e.g. "$4.20") — NEVER CELO/token/0x; small "Add funds" (network-fee copy only).
- Hero row: two large mode cards side-by-side — **Casual** (free, "Play now") and **Arena** (stakes, "$0.10–$1", neon border, "Play for real").
- Below: "Recent matches" mini-list (W/L, mode, amount). Bottom nav: Home / Play / History / Profile.
- States: loading (skeleton cards), zero-balance (Arena card shows "Add funds to play").

### 2. Matchmaking Queue
- Header: mode toggle Casual | Arena.
- Arena selected: stake selector chips ($0.10 / $0.25 / $0.50 / $1) — disabled chips if balance < stake (tooltip "Add funds").
- Center: large "Searching for opponent…" pulsing hex spinner + elapsed timer + Cancel button.
- On match: transition to `match_found` → brief "Opponent found: {alias}" then board.
- States: searching, opponent-found, cancelled, insufficient-balance.

### 3. In-Game Board
- Center: hex board radius-4 (61 cells), axial layout, player pieces in two neon colors; last-move + captured cells highlighted (flash).
- Top: opponent avatar/alias + their clock (mm:ss, turns red <15s).
- Bottom: own avatar + own clock + turn indicator ("Your turn" glowing / "Opponent's turn" dimmed).
- Corner: stake badge ($ for Arena, "Casual" tag otherwise), resign button.
- States: your-turn, opponent-turn, invalid-move shake, opponent-disconnected banner (countdown), move-animating.

### 4. Result / History
- Result modal: WIN/LOSE banner (neon green/red), reason ("Enclosed majority" / "Time out" / "Opponent left").
- Arena: prize line "You won $0.90" + subtle "Payout sent" status (NO tx hash/gas language; optional "view receipt").
- Actions: Rematch, Back to Dashboard.
- History screen: reverse-chronological list rows (date, mode, opponent alias, result, amount ±$), filter Casual/Arena. Empty state: "No matches yet — play your first game."

## Migration / Rollout
Greenfield — no migration. Rollout: (1) domain+tests, (2) server transport+Casual, (3) ledger+deposits, (4) ArenaSettlement deploy to Mainnet + settle wiring, (5) MiniPay UI + bundle gate, (6) talent.app registration.

## Open Questions
- [ ] Deposit ingestion: liquidation address vs polling backend wallet for transfers — confirm in spec.
- [ ] Abandon/disconnect grace period exact value (proposal left open; suggest 30s).
- [ ] Fee/rake on Arena prize pool (e.g. house cut %) — product decision, affects ledger payout math.
- [ ] Refund/VOID policy when both players disconnect or server crashes mid-match.
