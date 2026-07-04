# Tasks: shared-match-timer

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~450-650 (domain model change + protocol type change + server interval rewrite + test rewrites across 3 layers + UI rework) |
| 400-line budget risk | Medium-High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 `packages/shared` (domain + protocol, TDD) → PR2 `apps/server` (`matchSession.ts` interval rewrite, TDD) → PR3 `apps/web` (UI: single clock + capture count) |
| Delivery strategy | ask-on-risk |
| Chain strategy | CONFIRMED by user 2026-07-03: 3 chained PRs per suggested split — ALL 3 DONE |

Decision needed before apply: No — resolved
Chained PRs recommended: Yes
Chain strategy: 3 chained PRs (PR1 shared → PR2 server → PR3 web) — complete
400-line budget risk: Medium-High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | `packages/shared/domain/board.ts` + `protocol.ts`: reemplazar `clocks`/`Record<PlayerId,number>` por `matchClockMs`/`matchStartedAt`, reescribir `checkEnd()` para unificar timeout con mayoría | PR 1 | **DONE** — 24/24 tests verde |
| 2 | `apps/server/matchSession.ts`: reescribir el `setInterval` (D1+D2 del design — recálculo por `Date.now()`, sin mirar `state.turn`) | PR 2 | **DONE** — `packages/shared`+`apps/server`: 85/85 verde |
| 3 | `apps/web`: reemplazar `PlayerClock` (dos instancias) por reloj único + `CaptureCount`, actualizar `game/[matchId]/page.tsx` | PR 3 | **DONE** — `apps/web`: 111/111 verde |
| 4 | `docs/timers.md`: reescribir para reflejar el reloj compartido (reemplaza el doc actual, que queda obsoleto) | PR 3 | **DONE** |

## Phase 1: packages/shared — Domain & Protocol

- [x] 1.1 (RED) Actualizar `packages/shared/domain/board.test.ts`.
- [x] 1.2 (RED) Test: `checkEnd()` con `matchClockMs <= 0` y mayoría clara de piezas.
- [x] 1.3 (RED) Test: `checkEnd()` con `matchClockMs <= 0` y empate.
- [x] 1.4 (RED) Test: `createGame()` clampa al piso `MIN_MATCH_CLOCK_MS`.
- [x] 1.5 (GREEN) Implementar `GameState.matchClockMs`, `matchStartedAt`, `MIN_MATCH_CLOCK_MS`.
- [x] 1.6 (GREEN) Reescribir `checkEnd()` (D3).
- [x] 1.7 (GREEN) Actualizar `applyMove()`.
- [x] 1.8 (RED→GREEN) Actualizar `protocol/index.ts`.
- [x] 1.9 `npx vitest run packages/shared` — 5 test files, 24/24 verde.

## Phase 2: apps/server — Match Session

- [x] 2.1 (RED) Test: descuenta independientemente de `state.turn`.
- [x] 2.2 (RED) Test: recálculo por `Date.now()`, sin drift.
- [x] 2.3 (RED) Test: `finalize` con winner por mayoría, no hardcodeado.
- [x] 2.4 (GREEN) Reescrito el `setInterval`.
- [x] 2.5 (GREEN) `move_result`/`match_found` con `matchClockMs`.
- [x] 2.6 Verificado `resign`/`disconnect`/`resume`/`voidForServerError` sin regresión.
- [x] 2.7 `npx vitest run packages/shared apps/server` — 17 test files, 85/85 verde.

## Phase 3: apps/web — UI

- [x] 3.1 (RED) Test: `MatchClock` renderiza un único reloj compartido (`MatchClock.test.tsx`, 3 tests).
- [x] 3.2 (RED) Test: `countPieces()` (pura, `lib/captureCount.ts`) deriva el conteo de piezas del board, 3-3 al inicio; `PlayerStatusRow` renderiza y actualiza `capture-count` en rerender (`PlayerStatusRow.test.tsx`, 3 tests).
- [x] 3.3 (GREEN) Implementado `components/MatchClock.tsx` (reloj único, reemplaza el par de `PlayerClock`).
- [x] 3.4 (GREEN) Implementado `lib/captureCount.ts` + `components/PlayerStatusRow.tsx` (turno + conteo, sin campo nuevo del server).
- [x] 3.5 (GREEN) Actualizado `apps/web/app/game/[matchId]/page.tsx`: `MatchClock` arriba del tablero, dos `PlayerStatusRow` (oponente/self) con conteo derivado de `state.board`. Se agregó handler `clock_tick` para actualizar `matchClockMs` en vivo (antes solo llegaba embebido en `move_result`/`match_found`).
- [x] 3.6 `npx vitest run apps/web` — 27 test files, 111/111 verde. Eliminados `PlayerClock.tsx`/`PlayerClock.test.tsx` (reemplazados).

## Phase 4: Documentación

- [x] 4.1 Reescrito `docs/timers.md`: describe el reloj compartido, incluye sección "Versión anterior (reemplazada)" documentando el motivo del cambio.

## Phase 5: Integración

- [x] 5.1 `npx vitest run` (monorepo completo) — **44 test files, 196/196 tests verde**. `lint:copy` (`apps/web/bin/check-copy-rules.ts`) también pasa — 15 files scanned, 0 violaciones.
- [ ] 5.2 Smoke manual: partida completa donde el reloj compartido llega a 0 con piezas desparejas. **Pendiente** — requiere entorno corriendo (dev server + 2 clientes), no se hizo dentro de esta sesión de apply automatizada.
- [ ] 5.3 Smoke manual: partida que termina por board-full antes de que el reloj llegue a 0. **Pendiente**, mismo motivo que 5.2.
