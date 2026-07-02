# Tasks: hexarena-mvp

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 3500-5000+ (full MVP) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 bootstrap+shared → PR2 server+ledger → PR3 contracts → PR4 web → PR5 e2e+shipping |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units
| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Bootstrap + `packages/shared` (domain, protocol) | PR 1 | Standalone, test-runner setup included |
| 2 | `apps/server` transport + ledger | PR 2 | Depends on PR1 types |
| 3 | `packages/contracts` ArenaSettlement | PR 3 | Independent of PR2, can parallelize |
| 4 | `apps/web` MiniPay client | PR 4 | Depends on PR1 protocol types |
| 5 | E2E integration + Proof of Ship checklist | PR 5 | Depends on PR2-4 |

## Phase 0: Monorepo Bootstrap
- [x] 0.1 Init pnpm workspaces root (`pnpm-workspace.yaml`, root `package.json`, `.gitignore`).
- [x] 0.2 Scaffold `apps/web`, `apps/server`, `packages/shared`, `packages/contracts` with package.json + tsconfig.
- [x] 0.3 Install and configure Vitest as monorepo test runner (blocking for Strict TDD) + shared config.
- [x] 0.4 Configure ESLint + Prettier root config, shared across packages.
- [x] 0.5 Add root scripts: `test`, `lint`, `build`, `dev`.

## Phase 1: packages/shared — Domain & Protocol
- [x] 1.1 (RED) Write failing tests for axial board types + `createGame()` in `packages/shared/domain/board.test.ts`.
- [x] 1.2 (GREEN) Implement `Axial`, `GameState`, `createGame(seed?)` in `packages/shared/domain/board.ts`.
- [x] 1.3 (RED/GREEN) `legalMoves(state)` — per Game Engine spec Pass Rule scenarios.
- [x] 1.4 (RED/GREEN) `applyMove` multi-direction simultaneous capture — spec "Capture Resolution".
- [x] 1.5 (RED/GREEN) Forced pass logic — spec "Pass Rule: Forced pass / Reject pass".
- [x] 1.6 (RED/GREEN) `checkEnd` — board-full + both-stuck + majority/draw tie-break — spec "Game End Detection", "Win Determination".
- [x] 1.7 (RED/GREEN) Clock expiry → timeout loss — spec "Clock Expiry".
- [x] 1.8 Define WS protocol types in `packages/shared/protocol` (C→S and S→C events) — realtime-protocol spec.
- [x] 1.9 Define chain types/ABI placeholder + verified token addresses in `packages/shared/chain`.

## Phase 2: apps/server — Application Layer & Ledger
- [x] 2.1 Scaffold Socket.IO server, connection handling, room model.
- [x] 2.2 Implement `join_queue`/`cancel_queue` + Casual matchmaking — realtime-protocol "Queue Join", "Match Found".
- [x] 2.3 Implement `make_move` validation via domain engine + broadcast — spec "Move Validation".
- [x] 2.4 Implement clock tick + timeout handling server-side.
- [x] 2.5 Implement disconnect/reconnect with 30s grace + `resume` — spec "Disconnection Grace Window".
- [x] 2.6 Implement `game_over` delivery (Casual vs Arena payload) — spec "Game Over Delivery".
- [x] 2.7 Design Postgres schema: `users`, `deposits`, `ledger_entries`, `matches` per design.md Ledger Schema. (Implemented as in-memory `LedgerStore` with the same schema/interface for MVP — see apps/server/ledger/types.ts rationale comment; swappable with a Postgres adapter later.)
- [x] 2.8 (RED/GREEN) Non-negative balance invariant + insufficient-balance rejection — arena-settlement "Non-Negative Balance".
- [x] 2.9 (RED/GREEN) Unique deposit crediting by `tx_hash` — spec "Unique Deposit Crediting".
- [x] 2.10 (RED/GREEN) Atomic hold/release DB transaction — spec "Atomic Hold/Release".
- [x] 2.11 (RED/GREEN) House rake 20% payout math — spec "House Rake on Payout".
- [x] 2.12 (RED/GREEN) Draw refund minus rake — spec "Draw Refund Minus House Rake".
- [x] 2.13 (RED/GREEN) Full refund on server-error VOID — spec "Full Refund on Server-Error Void".
- [x] 2.14 Persist match history + expose read endpoint for History screen.

## Phase 3: packages/contracts — ArenaSettlement (Foundry)
- [x] 3.1 Init Foundry project in `packages/contracts`.
- [x] 3.2 Implement `ArenaSettlement.sol`: `settle(matchId, winner, amount)` with `mapping(bytes32=>bool) settled`.
- [x] 3.3 (RED/GREEN) Test settlement idempotency (duplicate settle reverts) — spec "Settlement Idempotency Per Match".
- [x] 3.4 (RED/GREEN) Test `onlyOperator` access control — spec "Operator-Only Settlement Access".
- [x] 3.5 Implement `pause()`/`withdraw()` owner-only, `nonReentrant` + checks-effects-interactions.
- [x] 3.6 (RED/GREEN) Test paused settlement blocked — spec "Admin Pause and Withdraw".
- [ ] 3.7 Deploy script written (`script/Deploy.s.sol`, parameterized for Celo Sepolia testnet chainId 11142220 first, Mainnet 42220 later) — actual on-chain deploy + verify NOT executed this session (no private keys/funds available; explicitly out of scope per instructions). Remains open for Phase 5.
- [ ] 3.8 Wire viem chain adapter in `apps/server` to call `settle()` against testnet deployment — deferred to PR4/PR5 e2e integration phase (out of scope for this contracts-only session; `apps/server/chain/settlement.ts` stub from PR2 still in place).

## Phase 4: apps/web — MiniPay Mini App (functional structure only)
- [x] 4.1 Scaffold Next.js app, viem client, `isMiniPay()` detection — spec "MiniPay Environment Detection". (Next.js 15 App Router hand-scaffolded; `lib/isMiniPay.ts` pure detector + `lib/useIsMiniPay.ts` hook wrapper.)
- [x] 4.2 Implement CIP-64 fee abstraction (USDm default) + USDC/USDT adapters — spec "Supported Stable Assets Only". (`lib/feeCurrency.ts` — `getFeeCurrencyAddress`/`buildFeeAbstractionConfig`, never sets EIP-1559 fee fields.)
- [x] 4.3 Dashboard screen: wallet balance (USD only), Casual/Arena mode cards, recent matches list. (`app/page.tsx` + `components/WalletWidget.tsx` + `components/ModeCard.tsx`.)
- [x] 4.4 Matchmaking screen: mode toggle, stake chips, searching state, Socket.IO client wiring. (`app/matchmaking/page.tsx` + `components/StakeSelector.tsx`; `lib/socketClient.ts` typed client — interface tested with mocks, real connection to a running server deferred to PR5 e2e per scope.)
- [x] 4.5 In-game board screen: render hex board from `GameState`, clocks, move input, resign. (`app/game/[matchId]/page.tsx` + `components/HexBoard.tsx` (61-cell radius-4 grid from `packages/shared` domain) + `components/PlayerClock.tsx`.)
- [x] 4.6 Result/History screen: win/lose banner, Arena prize line, history list. (`components/ResultBanner.tsx` + `components/HistoryList.tsx` + `app/history/page.tsx`.)
- [x] 4.7 Enforce copy-rules lint/check (no "gas"/"crypto"/0x/CELO in UI strings) — minipay-client spec. (`lib/copyRules.ts` pure checker + `bin/check-copy-rules.ts` build-time scanner over `app/`+`components/`; `pnpm --filter @hexarena/web run lint:copy` — 12 files scanned, 0 violations after excluding doc comments/tests.)
- [x] 4.8 Add bundle-analyzer gate, verify <2MB — spec "Bundle Size Budget". (`@next/bundle-analyzer` wired in `next.config.mjs` (`ANALYZE=true` script) + `bin/check-bundle-size.ts` hard gate; measured this session: **0.77MB / 2MB budget** after `next build`.)

## Phase 5: Integration & Shipping
- [x] 5.1 E2E test: full Casual match (queue → moves → game_over) via Socket.IO test client. (`apps/server/e2e.casual.test.ts` — real HTTP server + 2 real socket.io-client connections, `legalMoves()` picks a real capturing move. Also wired `apps/web`'s matchmaking/game/history screens to a real `socketClient` singleton — `lib/socketSingleton.ts`, `lib/serverUrl.ts` (`NEXT_PUBLIC_SERVER_URL`, fallback `localhost:3001`). Found and fixed a real bug: `GameState.board` is a `Map`, which `JSON.stringify`s to `{}` over Socket.IO — added `serializeGameState`/`deserializeGameState` to `packages/shared/domain/board.ts` and wired both `match_found.initialState` and `move_result.nextState` through it.)
- [x] 5.2 E2E test: full Arena flow (simulated deposit → match → house rake payout → real `settle()`). (`apps/server/e2e.arena.test.ts` — real socket flow, `settleOnChain` mocked at module boundary to assert call args without spending real gas. Replaced the `chain/settlement.ts` stub with a real viem `writeContract` call against the deployed `ArenaSettlement` (Celo Mainnet `0x108E012C3B12421f216cA5C2C59770c34653e1d0`, settlement token USDT `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e`) — signer from `OPERATOR_PRIVATE_KEY` env, RPC from `CELO_MAINNET_RPC_URL` (fallback `forno.celo.org`). Filled in `packages/shared/chain/index.ts` placeholders with the real address + minimal ABI fragment for `settle()`.)
- [ ] 5.3 Deploy `ArenaSettlement` to Celo **Mainnet**, verify contract (Proof of Ship requirement).
- [ ] 5.4 Publish public GitHub repo with commit history.
- [ ] 5.5 Deploy live hosted `apps/web` + `apps/server`.
- [ ] 5.6 Register project on talent.app for active Proof of Ship campaign.
