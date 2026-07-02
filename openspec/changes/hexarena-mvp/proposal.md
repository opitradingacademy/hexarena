## Proposal: hexarena-mvp

### Intent
**Problem**: HexArena is a greenfield hex-board strategy game (GDD v1.0) with no code yet. We need a shippable MVP that (1) delivers a fun, server-authoritative 1v1 hex-capture game, and (2) monetizes via Arena stake matches on Celo/MiniPay — while simultaneously QUALIFYING for Celo Proof of Ship (Season 2, ends 2026-06-30, up to 2000 USDT rewards; real-reward games with USDm prize pools are Tier 1 fit).

**Why now**: Proof of Ship Season 2 has a hard deadline and hard qualification requirements. The exploration's recommendation (backend custody, NO on-chain escrow) is correct for game-loop speed but has a FATAL gap for this program: Proof of Ship REQUIRES at least one smart contract deployed to Celo **Mainnet** (not testnet), a public GitHub repo, a live hosted app, and registration on talent.app. A purely backend-custodied Arena leaves zero contracts on Mainnet and DISQUALIFIES the project. The proposal must reconcile "fast off-chain game loop" with "real on-chain contract."

**Success looks like**:
- Casual 1v1 hex matches playable end-to-end (matchmaking, authoritative turns, Blitz clock, capture, win/abandon resolution).
- Arena stake matches ($0.10/$0.25/$0.50/$1) with deposit, match accounting, and winner payout.
- At least ONE meaningful smart contract live on Celo Mainnet, exercised by the real business flow (not filler).
- Live hosted app, public GitHub repo, talent.app registration → Proof of Ship qualified.
- MiniPay-compliant UX (copy rules, <2MB bundle, fee abstraction).

### Scope

**In scope (MVP)**:
- Hex board engine: axial coords (q,r), radius-4 (61 cells), 6-direction capture-by-enclosure, win = most cells controlled, end conditions (no legal moves / board full).
- Pure, framework-agnostic domain module (ports-and-adapters) for game authority: turn state machine, Blitz clock (90-120s/player), capture validation, win detection — fully unit-testable, transport-independent.
- Socket.IO real-time transport: rooms, matchmaking, turn acks, reconnection with session resume, abandon/disconnect auto-loss after configurable grace period.
- Casual 1v1 mode (no stakes).
- Arena mode: USD-denominated stakes, backend custody + liquidation address for deposits/match accounting, and ON-CHAIN winner settlement (see Approach).
- One Celo Mainnet smart contract: **ArenaSettlement / PayoutDistributor** (see below).
- MiniPay integration: `isMiniPay()` gating (nice-to-have for scoring), CIP-64 fee abstraction via viem, legacy-tx-only signing, strict copy rules.
- Monorepo: `apps/web` (Next.js Mini App), `apps/server` (Node/Socket.IO), `packages/shared` (board math + protocol types + contract ABI/addresses).
- Deployment: live hosted web + server, public GitHub repo, talent.app project registration.

**Out of scope (v2 / future)**:
- Tournaments, seasons, special abilities (explicitly deferred per GDD + user).
- Per-match on-chain escrow (rejected — conflicts with Blitz pacing).
- Non-MiniPay wallet connectors, multi-chain.
- Regulatory/compliance framework beyond a correct internal ledger (flagged as risk, not built out in MVP).
- Ranked ladder / ELO, cosmetics, spectator mode.

### Approach

**1. Board & game authority** — Axial coordinates (q,r); 6 constant direction vectors; capture-scan = walk-in-direction, collect enemy run, confirm bounding own piece. Game authority lives in a PURE domain module (no Socket.IO imports) exposed via ports; Socket.IO is an adapter. Rationale: minimal storage, no parity branching, trivially unit-testable, transport swappable (ws later without touching logic). Matches user's hexagonal-architecture preference. Spec phase must formalize capture edge cases (simultaneous multi-direction captures, pass rule, one-player-has-no-moves).

**2. Transport** — Socket.IO for MVP speed: built-in reconnection/rooms/acks map directly to GDD's abandon-timeout + turn-ack needs. Wire protocol (message shapes) defined in `packages/shared`.

**3. Arena custody + on-chain settlement (RESOLVES the Proof of Ship tension)** —
Chosen: **Option (a) elevated to a real business contract, NOT filler** — a hybrid.
- Deposits: single on-chain top-up to backend-custodied balance (no per-match gas). Match stakes accounted off-chain in an internal ledger (fast, fits 2-4 min Blitz).
- Winner PAYOUTS: executed through a minimal Mainnet smart contract, **ArenaSettlement (PayoutDistributor)** — backend calls `settle(matchId, winner, amount)`; contract disburses the prize in USDm/USDC/USDT and emits an auditable on-chain settlement event.
- Net effect: the game loop stays 100% off-chain (fast), the DEPOSIT and the PAYOUT touch chain (payout via the contract). The contract is exercised by the genuine business flow — it records real Arena results and moves real prize funds — so it satisfies Proof of Ship's "contract on Mainnet" requirement AUTHENTICALLY and lands in Tier 1 (real-reward game with USDm prizes).

**Tradeoff vs the alternatives**:
- vs pure backend custody (exploration's rec): that path is simplest but DISQUALIFIES from Proof of Ship (no Mainnet contract). Rejected on program grounds.
- vs option (b) full per-match on-chain escrow: trustless but two txns/match + gas friction + smart-contract fund-loss risk on every game; conflicts with Blitz pacing at $0.10-$1 stakes. Rejected as over-engineering for MVP.
- vs option (a) as a pure "filler" contract (e.g., achievement NFT unrelated to money): qualifies technically but is inauthentic, wastes audit/dev effort on throwaway code, and scores worse than a real-reward mechanic. Rejected.
- Chosen hybrid keeps the hot path off-chain (speed) while making SETTLEMENT on-chain and verifiable (qualification + trust signal), concentrating smart-contract risk on the single payout path rather than every match. Design phase must decide: whether the contract holds a prize float (backend funds it) or pulls from a treasury, access control (backend as sole settler → operator-trust caveat), reentrancy/idempotency on `settle` (matchId dedupe), and pause/withdraw admin controls.

**4. MiniPay / Celo integration (verified addresses)** —
- Fee abstraction (CIP-64) via **viem only** (ethers/web3 lack native `feeCurrency`). MiniPay defaults to USDm for fees.
- Legacy transactions only (MiniPay does NOT accept `maxFeePerGas`/`maxPriorityFeePerGas`).
- Verified Mainnet addresses (store in `packages/shared`):
  - USDm (cUSD): `0x765DE816845861e75A25fCA122bb6898B8B1282a` (token == feeCurrency)
  - USDC: token `0xcebA9300f2b948710d2653dD7B07f33A8B32118C`, feeCurrency adapter `0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B`
  - USDT: token `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e`, feeCurrency adapter `0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72`
- `isMiniPay()` gating: branch UI when in MiniPay context (no fallback connector needed there); no longer mandatory but adds Proof of Ship score.
- MANDATORY copy rules across all UI: never "gas"/"gas fee" → "network fee"/"comisión de red"; never "crypto"/"crypto token" → "stablecoin"/"dólar digital"; never surface CELO or 0x addresses as primary identifier → use phone/alias; only USDT/USDC/USDm in scope, CELO never visible.
- Bundle: MiniPay hard limit <2MB JS → code splitting + minimal deps from day one (favor viem over heavier libs, lazy-load board renderer/wallet flows).

**5. Repo** — Monorepo (pnpm workspaces): `apps/web`, `apps/server`, `packages/shared` (board math, WS protocol types, contract ABI + verified addresses). Shared types prevent client/server protocol drift during fast MVP iteration. Public GitHub repo (Proof of Ship requirement).

**6. Proof of Ship compliance checklist (must all be true at ship)**:
- [ ] ArenaSettlement contract deployed & verified on Celo **Mainnet**
- [ ] Public GitHub repo with real commit history
- [ ] Live hosted app (web + server)
- [ ] Project registered on talent.app for the active campaign
- [ ] (bonus) isMiniPay() hook present

### Open questions for spec/design
- ArenaSettlement funding model (prize float vs treasury pull) and admin/pause controls.
- Settle idempotency + access control (operator-trust boundary).
- Internal ledger schema for backend custody (reconciliation, no negative balances/double-spend).
- Exact capture algorithm edge cases + WS wire protocol shape.
- Abandon/disconnect grace-period values.
