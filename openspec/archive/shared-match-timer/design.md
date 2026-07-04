# Design: shared-match-timer

## Technical Approach

Reemplazar `GameState.clocks: Record<PlayerId, number>` (dos relojes independientes, pausados/reanudados por turno) por un único `GameState.matchClockMs: number` (un reloj de partida, corre en tiempo real desde `createGame()`, nunca pausa). `checkEnd()` deja de tratar "reloj agotado" como un resultado distinto (`reason: "timeout"` = derrota automática de quien tenía el turno); pasa a ser un TRIGGER que fuerza la misma evaluación de mayoría-de-celdas que ya existe para board-full/both-stuck. El server (`matchSession.ts`) sigue siendo la única fuente autoritativa del tiempo — el cliente solo renderiza.

## Architecture Decisions

### D1: Dónde vive el descuento del reloj compartido

| Opción | Tradeoff | Decisión |
|---|---|---|
| (a) `setInterval` único en `matchSession.ts` descuenta `matchClockMs` cada 1000ms, sin mirar `state.turn` | Cambio mínimo sobre el interval ya existente (solo se saca el `if (toMove)` y se descuenta un valor plano) | **ELEGIDA** |
| (b) Calcular tiempo restante on-demand por diferencia de timestamps (`matchStartedAt`) sin interval de descuento | Evita drift de `setInterval` bajo carga, pero requiere recalcular en cada `checkEnd()` y complica el broadcast de `clock_tick` (¿quién dispara el emit?) | Rechazada para MVP — el interval ya existe y funciona; se resuelve el drift con el fix D2 |

### D2: Precisión del reloj bajo drift de `setInterval`

`setInterval(fn, 1000)` no garantiza exactamente 1000ms por tick (drift acumulativo bajo carga de CPU/GC). Para un reloj de partida de 3+ minutos que decide dinero real (Arena), un drift de algunos segundos en 180 ticks es aceptable para MVP pero se documenta como riesgo conocido: el server MUST usar `Date.now()` en vez de contar ticks para el valor autoritativo — es decir, en cada tick se recalcula `matchClockMs = max(0, matchStartedAt + totalMs - Date.now())` en lugar de `matchClockMs -= 1000`. Esto es un cambio pequeño sobre la implementación actual y elimina el drift acumulativo sin necesitar la opción (b) de D1.

### D3: Reason string para clock-expiry en `game_over`

| Opción | Tradeoff | Decisión |
|---|---|---|
| (a) Mantener `reason: "timeout"` pero el campo `winner` se computa por mayoría (puede ser `null` en empate) | Reason string no cambia — mínimo blast radius en clientes/tests que ya switchean sobre `"timeout"` | **ELEGIDA** |
| (b) Introducir `reason: "clock-expiry-majority"` nuevo, distinto de `"timeout"` | Más explícito semánticamente, pero rompe cualquier código/test que ya asuma el enum de 4 reasons (`majority`, `draw`, `timeout`, `abandon`, `resign`) | Rechazada — no hay necesidad funcional de distinguir la CAUSA del fin de partida del RESULTADO; el frontend ya muestra el ganador por conteo de piezas en el `ResultBanner`, no por reason |

Nota: esto significa que `reason: "timeout"` deja de implicar "alguien perdió por reloj" y pasa a significar solo "el reloj compartido llegó a 0, y el resultado se calculó por mayoría" — semánticamente distinto del comportamiento viejo aunque el string no cambie. Se documenta explícitamente en el código (comentario en `checkEnd()`) para que quede claro a futuros lectores.

### D4: Migración del payload de protocolo (`clocks` → `matchClockMs`)

Breaking change de forma en `match_found`, `move_result`, `clock_tick` (de `Record<PlayerId, number>` a `number`). Como el MVP no tiene versionado de protocolo ni clientes en producción con partidas activas 24/7 (Arena es point-in-time), se hace un cambio directo sin capa de compatibilidad — server y client se despliegan juntos. Rationale: agregar un campo de compat temporal (`clocks` Y `matchClockMs` en paralelo) sería complejidad innecesaria para un monorepo donde ambos lados se versionan y despliegan atómicamente.

## Data Flow

Match tick (reemplaza el flow actual en `matchSession.ts` líneas 92-108):
```
setInterval(1000ms) →
  matchClockMs = max(0, matchStartedAt + INITIAL_CLOCK_MS - Date.now())
  emit("*", "clock_tick", { matchClockMs })
  if (matchClockMs === 0) → checkEnd(state) fuerza evaluación de mayoría → finalize("timeout", winnerByMajority)
```

Game over (unificado, ya no bifurca por causa):
```
checkEnd(state):
  if matchClockMs <= 0 OR boardFull OR bothStuck:
    → compute majority(board) → { over: true, winner, reason }
  else:
    → { over: false }
```

## Interfaces / Contracts (cambios sobre `packages/shared/domain/board.ts`)

```ts
type GameState = {
  board: Map<string, PlayerId | null>;
  turn: PlayerId;
  matchClockMs: number;        // reemplaza clocks: Record<PlayerId, number>
  matchStartedAt: number;      // Date.now() al crear el match — nuevo campo, necesario para D2
  status: GameStatus;
  consecutivePasses: number;
};

const MIN_MATCH_CLOCK_MS = 3 * 60 * 1000; // piso de 3 minutos, spec game-engine "Minimum clock floor"

function createGame(seed?: string, matchClockMs = MIN_MATCH_CLOCK_MS): GameState;
function checkEnd(state: GameState, now = Date.now()): EndResult;
// checkEnd ahora necesita `now` (o recibe matchClockMs ya recalculado) para decidir expiry —
// a diferencia de la versión actual que solo miraba state.clocks[state.turn].
```

Protocolo (`packages/shared/protocol.ts`):
```ts
// ANTES: match_found{..., clocks: Record<PlayerId, number>}
// DESPUÉS:
type MatchFoundPayload = { matchId; opponent; color; initialState; matchClockMs: number };
type MoveResultPayload = { matchId; by; at; captures; nextState; matchClockMs: number };
type ClockTickPayload = { matchClockMs: number };
```

## UI (Live Captured-Piece Count)

Derivado, no persistido: `apps/web` computa el conteo contando `[...state.board.values()]` filtrando por `PlayerId` en cada render tras `move_result`/`nextState` — no requiere un campo nuevo del server (la spec minipay-client ya lo marca como "near-free"). Se reemplaza `PlayerClock` (dos instancias, una por jugador) por un componente único `MatchClock` (un solo countdown) + un componente nuevo `CaptureCount` (o extensión de `PlayerClock` para mostrar ambos: reloj compartido arriba, conteo de piezas por jugador abajo/al costado). Decisión de layout exacto se deja a `sdd-tasks`/implementación — no es una decisión arquitectónica.

## Riesgos y no-objetivos

- **No** se resuelve en este cambio si el reloj compartido se pausa durante la ventana de gracia de desconexión (`DISCONNECT_GRACE_MS`, 30s) — hoy el reloj de partida (per-player) tampoco se pausaba durante esa ventana según el código actual (el `clockInterval` sigue corriendo mientras el `graceTimers` cuenta en paralelo), así que el comportamiento se mantiene sin cambios: el reloj compartido sigue corriendo durante la desconexión también. Si el producto quiere pausarlo, es un cambio futuro separado.
- **Riesgo de drift de `setInterval`** mitigado por D2 (recalcular por `Date.now()` en cada tick en vez de decrementar).
- **Breaking change de protocolo** aceptado sin capa de compatibilidad (D4) — server y web se despliegan atómicamente.
