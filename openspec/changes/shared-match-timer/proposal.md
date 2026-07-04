# Propuesta: shared-match-timer

## Contexto (exploración)

**Estado actual (sudden-death per-player clock):**

- `packages/shared/domain/board.ts`: `GameState.clocks: Record<PlayerId, number>`, inicializado en `createGame()` con `DEFAULT_CLOCK_MS = 3 * 60 * 1000` para cada jugador. `checkEnd()` (línea 231-234) chequea `state.clocks[state.turn] <= 0` ANTES de mirar el tablero — si el reloj del jugador a quien le toca mover llegó a 0, ese jugador pierde automáticamente (`reason: "timeout"`), sin importar cuántas piezas tiene en el tablero.
- `apps/server/matchSession.ts` (líneas 92-108): un único `setInterval` de 1000ms descuenta el reloj del jugador `state.turn` (turn-based pause/resume — solo corre el reloj de quien tiene el turno), emite `clock_tick` con ambos relojes, y llama `checkEnd()` tras cada tick. Si `checkEnd()` devuelve `over: true` con `reason: timeout`, se finaliza el match como `"timeout"` — un reason distinto de `"majority"`/`"draw"` (el path de board-full).
- `apps/web/app/game/[matchId]/page.tsx` + `components/PlayerClock.tsx`: la UI muestra dos relojes (`PlayerClock` para self y oponente), cada uno recibe `remainingMs` de `state.clocks[player]` e `isTurn` para saber cuál está corriendo. No hay ningún contador de piezas capturadas visible hoy.
- `docs/timers.md`: documenta exactamente este comportamiento (reloj por jugador, pausa/resume por turno, pierde quien llega a 0) y lo declara autoritativo del lado server.

**Motivación del cambio (comunicada por el dueño del proyecto):** el reloj sudden-death por jugador premia jugar rápido por sobre jugar bien — un jugador débil que mueve instantáneamente puede forzar una victoria agotando el reloj de un rival más fuerte, lo cual no encaja con un juego sobre capturar piezas, especialmente porque el modo Arena tiene dinero real en juego. Se quiere que el conteo de piezas (skill real) decida las partidas, no la gestión del reloj.

## Qué cambia

1. **Un solo reloj compartido por partida** (mínimo 3 minutos), que corre en tiempo real desde el inicio del match, SIN pausar/reanudar por turno (a diferencia del reloj actual por jugador).
2. **Cuando el reloj compartido llega a 0**, el match termina inmediatamente y se puntúa EXACTAMENTE igual que un final normal (tablero lleno / sin movidas legales): gana quien tenga más discos capturados/colocados en el tablero. Esto unifica el path de "timeout" con el path de "board-full" en una sola regla de scoring, en vez de la regla actual "a quien se le acaba el reloj pierde automáticamente sin importar el tablero".
3. **La UI del tablero debe mostrar un conteo en vivo de piezas capturadas** por cada jugador durante la partida (near-free: el estado del tablero ya trackea colores de pieza por celda — se puede derivar contando `board.values()`).

## Por qué no es solo un ajuste de constante

El cambio no es "aumentar `DEFAULT_CLOCK_MS`" — es un cambio de modelo:
- `clocks: Record<PlayerId, number>` (dos relojes por jugador) pasa a ser un solo reloj de partida (`matchClockMs: number` o similar), no atado a `turn`.
- El `setInterval` en `matchSession.ts` deja de mirar `state.turn` para decidir a quién descontarle — corre continuamente desde el `matchId` creado.
- `checkEnd()` deja de tener un branch `reason: "timeout"` que gana/pierde por reloj-agotado-de-quien-mueve; el timeout pasa a ser un TRIGGER que fuerza la evaluación de mayoría de piezas (mismo cálculo que ya existe para `boardFull`/`bothStuck`), no un resultado distinto.
- El protocolo realtime (`GameOverReason`, `clock_tick` payload) cambia de forma: de `{ clocks: Record<PlayerId, number> }` a algo como `{ matchClockMs: number }`.

## Riesgo de tamaño

Toca: `packages/shared/domain/board.ts` (modelo de estado + `checkEnd`), `packages/shared/protocol.ts` (tipos de payload), `apps/server/matchSession.ts` (lógica del interval), `apps/web/app/game/[matchId]/page.tsx` + `components/PlayerClock.tsx` (rename/adaptación UI) + nuevo componente de conteo de capturas, y sus tests (`board.test.ts`, tests de `matchSession`, tests de componentes web). Estimado: cambio de tamaño medio, contenido a un dominio (game timing) pero cruza las 3 capas (shared/server/web) — candidato razonable para 1-2 PRs encadenados en vez de uno solo, a resolver en `sdd-tasks` según el forecast de review workload.

## Fuera de alcance

- No se toca `DISCONNECT_GRACE_MS` (timer de reconexión) — es independiente y ya funciona bien.
- No se cambia el valor mínimo salvo para garantizar el piso de 3 minutos ya vigente.
- No se resuelve todavía si el reloj compartido admite pausa por desconexión (a definir en design.md).
