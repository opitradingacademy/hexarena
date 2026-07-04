# HexArena

Othello sobre tablero hexagonal para MiniPay (Celo). Ver `proyecto.md` para el GDD completo.

## Estado del proyecto

Desarrollo guiado por SDD (Spec-Driven Development), modo **hybrid** (artefactos en `openspec/` + Engram). Cambios: **`hexarena-mvp`** (base del MVP) y **`shared-match-timer`** (reglas de tiempo, ver abajo).

- Artefactos SDD: `openspec/changes/hexarena-mvp/` y `openspec/changes/shared-match-timer/` (proposal, design, specs/, tasks.md, state.yaml cada uno).
- Estado del DAG: revisar `state.yaml` del cambio correspondiente antes de asumir qué fase sigue.
- Progreso de implementación detallado: Engram, topic_key `sdd/hexarena-mvp/apply-progress` y `sdd/shared-match-timer/apply-progress`.

### Reglas de tiempo: reloj compartido de partida (2026-07-04, `shared-match-timer`)

Reemplazado el reloj sudden-death por jugador por un **reloj único de partida** (piso 3 minutos) que corre en tiempo real sin pausar por turno. Al llegar a 0, el match termina y se puntúa **igual que un final normal de tablero** (gana quien tenga más piezas; empate en piezas = draw) — ya no pierde automáticamente quien se quedó sin tiempo. El tablero ahora muestra el conteo de piezas capturadas en vivo por jugador.

- **Por qué**: el reloj por jugador premiaba jugar rápido por sobre jugar bien — un jugador débil podía forzar la victoria agotando el reloj de uno más fuerte, algo que no tiene sentido en un juego de captura de piezas con dinero real en juego (modo Arena).
- **Qué cambió**: `packages/shared/domain/board.ts` (`GameState.clocks: Record<PlayerId, number>` → `matchClockMs` + `matchStartedAt`; `checkEnd()` ya no declara derrota automática por reloj, dispara la misma evaluación de mayoría que board-full/both-stuck), `packages/shared/protocol/index.ts` (payloads con `matchClockMs` en vez de `clocks`), `apps/server/matchSession.ts` (el reloj se recalcula contra `Date.now()` en cada tick, no se decrementa 1000ms — elimina drift acumulado de `setInterval` en partidas de 3+ min), `apps/web` (`MatchClock.tsx` + `PlayerStatusRow.tsx` + `lib/captureCount.ts` reemplazan `PlayerClock.tsx`).
- **Detalle retenido a propósito**: el string `reason: "timeout"` en `game_over` se mantiene por compatibilidad, pero ahora significa "se acabó el reloj compartido y se resolvió por mayoría de piezas", no "alguien perdió por reloj". El settlement de Arena para empates depende de `winner === null`, no del string `reason`, así que no hubo riesgo de regresión ahí (confirmado en `sdd-verify`).
- **Deploy**: 3 commits encadenados en `main` (`b27ad26` shared, `e274686` server, `6b54b27` web), 196/196 tests verde, `sdd-verify` PASS (0 críticos), deployado a Vercel + Railway (auto-deploy por push), **probado en vivo por el usuario y confirmado funcionando bien**.
- **Pendiente no bloqueante**: `docs/timers.md` fue reescrito por el sub-agente para documentar el comportamiento nuevo, pero **el usuario pidió explícitamente no trackearlo en git** — queda como archivo local sin commitear, no es la fuente de verdad versionada. `sdd-archive` de este cambio todavía no se corrió.

### Estado actual al cierre (2026-07-04)

- **SQLite persistente en Railway ✅ RESUELTO.** Volume montado en `/data` con `SQLITE_PATH=/data/hexarena.db`. Smoke test verificado: depósito $0.10 USDT → `GET /api/balance` → redeploy forzado → balance persiste intacto. El bloqueador #1 del MVP quedó eliminado. El server ya no cae al `/tmp/hexarena.db` efímero. Log de validación al boot: `using sqlite ledger at /data/hexarena.db` — si ves `cannot write to /data, falling back to memory ledger...` el volume no está montado. **Caveat**: Railway Free tier NO soporta volumes — mínimo Hobby ($5/mes, 1 GB storage incluido, alcanza para los próximos 12 meses sin upgrade).
- **Treasury control externo ✅ RESUELTO sin tocar código.** El usuario importó la `OPERATOR_PRIVATE_KEY` actual a una wallet externa (MetaMask). Los fondos del Arena siguen yendo a `0x34d5d015B4805E985619D0F4aaCb6343a6457fF2`, pero ahora el user puede ver el balance, mover USDT y recibir notificaciones (CeloScan alerts) sin correr scripts. `scripts/recover-treasury-funds.ts` sigue siendo útil solo para edge cases (drift entre ledger y chain, fondos huérfanos), no para operaciones rutinarias.

**Al día de hoy (2026-07-03, cierre de sesión de debugging extendida + feature de carga de saldo desde el Home):**

- PR1–PR5 completados, deployados en producción.
- **Feature "Cargar saldo desde el Home" completada y deployada** (ver `implementation_plan.md`): el Dashboard (`apps/web/app/page.tsx`) muestra una única tarjeta de balance premium con Game Balance (Ledger) + Wallet Balance (on-chain) y un botón "Deposit" que abre el mismo flujo de `StakeConfirmDialog`. Se retiró intencionalmente el `WalletWidget` del navbar (arriba a la derecha) por quedar redundante y confuso al lado de la tarjeta — `WalletWidget.tsx`/`.test.tsx` quedan en el repo sin uso actual, por si se reutilizan en otra pantalla. Commits: `fa08f39` (feature), `b278db4` (fix `reload` vs `refresh` en `useUsdtBalance`), `1c2bff5` (remove navbar widget).
- **Gotcha de deploy**: correr `vercel --prod` desde `apps/web` ignora el `vercel.json` de la raíz y usa npm en vez de pnpm, rompiendo por el protocolo `workspace:^`. Siempre correr `vercel --prod` desde la raíz del repo.
- **Gotcha de tests**: Vitest en este repo NO tipa (esbuild transpile-only) — un nombre de propiedad incorrecto en el valor de retorno de un hook (ej. `refresh` vs `reload`) pasa los tests pero rompe `next build`. Correr `pnpm exec tsc --noEmit` (o confiar en el build de Next) antes de dar un cambio por terminado.
- **Test flaky preexistente (no resuelto, no bloqueante)**: `apps/web/app/matchmaking/page.test.tsx` — el placeholder "Loading wallet…" y el `StakeConfirmDialog` real comparten `data-testid="stake-confirm-dialog"`, por lo que `waitFor(() => getByTestId(...))` a veces resuelve sobre el placeholder antes de que `senderAddress` esté listo, y el click subsiguiente en `stake-confirm-button` falla. Afecta 2/186 tests de forma intermitente.
- Operator treasury address real configurada en Railway: `0x34d5d015B4805E985619D0F4aaCb6343a6457fF2` (separada de la wallet del user).
- 169/169 tests Vitest verde al cierre de cada PR; serie de fixes de esta sesión movió la suite a **186/186 verde**.

### Estado del Arena deposit flow al cierre

**Causa raíz del modal-loop de firmas redundantes e insuficiencia de saldo artificial (Identificado y solucionado):**

A pesar de tener saldo, el flujo de depósito volvía a pedir firma debido a dos factores:

1. **Discrepancia de case-sensitivity del `userId`:** En `apps/server/server.ts`, el `userIdFor(socket)` resolvía la wallet del handshake sin normalizar (posiblemente lowercase). Sin embargo, los endpoints `/api/deposit` y `/api/balance` normalizaban usando `getAddress` (casing con checksum EIP-55). En la base de datos SQLite (case-sensitive), el saldo del usuario se acreditaba bajo la wallet checksummed (`0x34D...`), pero el socket ejecutaba `join_queue` bajo el `userId` en minúsculas (`0x34d...`), devolviendo balance 0 y disparando `INSUFFICIENT_BALANCE` de forma infinita.
2. **Reseteo del diálogo a `idle`:** El diálogo `StakeConfirmDialog` reseteaba su estado a `idle` al reabrirse, perdiendo cualquier tracking de transacción firmada previa en curso y obligando a firmar de nuevo.

**El fix definitivo:** `userIdFor(socket)` ahora normaliza la wallet con `getAddress(walletAddress)` al igual que el resto del backend, haciendo que el ID del socket coincida exactamente con los registros del Ledger en la base de datos.

### Hallazgos críticos de esta sesión de debugging

Cada uno es un bug real que hubiera roto el flow en device físico. Los 4 primeros síntomas son reales; solo el #5 y #6 son las causas raíces definitivas.

1. **MiniPay `eth_getTransactionReceipt` returns null/throws** incluso para tx minadas, porque el provider-stub del WebView tiene una vista local atrasada del chain state. Cliente delega al server slow-path de 40s con multi-RPC polling. (commits `c1495c5`, `c8fe73c`)
2. **Public RPC propagation lag** (publicNode/forno) de 2-30s para tx recién minadas. Server bypasses fallback-sequencial y hace poll paralelo contra múltiples RPCs (`primaryClient` + `fornoClient`). (commit `8774eba`)
3. **`MemoryLedgerStore` perdía el balance en cada redeploy** de Railway. Reemplazado por `SqliteLedgerStore` con `better-sqlite3`. Default `/tmp/hexarena.db` (writable pero volátil); para persistencia real setear `SQLITE_PATH=/data/hexarena.db` con un volume montado. (commit `0ef5812`)
4. **`Matchmaker.join()` matcheaba al user consigo mismo** cuando su entry anterior seguía en la queue (porque `cancel_queue` solo se dispara en user action, no en socket disconnect). Filtrar self-entries en el lookup. (commit `66a15e2`)
5. **La causa raíz definitiva de la inyección**: `socketSingleton.ts` cacheaba `walletAddress` en module-load — reescrito para resolverlo async en cada reconnect. (commit `7dd3c0c`)
6. **La causa raíz definitiva de firmas duplicadas/insuficiencia de saldo**: Discrepancia entre `userId` de socket sin normalizar (lowercase) y el Ledger en SQLite (casing checksummed de EIP-55 via `getAddress`), provocando que la cola de matchmaking leyera balance 0 e ignorara los depósitos ya acreditados.

### Trabajo complementario de la sesión

- **`GET /api/balance?wallet=<addr>`** nuevo endpoint para debugging del ledger del server desde afuera. (commit `45e4b86`)
- **`useServerLedger` hook** en cliente lee el balance del server (no la wallet on-chain, que suele ser otro número). (commit `69c6313`)
- **`Matchmaking` screen reescrito**: modal se auto-abre al tocar Find Match con balance insuficiente (sin mensaje de error visible); nunca reabre después de firmar gracias a `await refreshBalance()` antes de cualquier decisión. Chips de stake siempre clickeables (hint "Top up" si el balance no cubre). (commits `0a7baa1`, `430244e`)
- **`scripts/recover-treasury-funds.ts`** recuperó ~$0.41 USDT de fondos atascados en `0x34d5d015...` desde que el server se reiniciaba y perdía los credits. Ejecutado en chunks chicos por un quirk del USDT de Celo (ver nota abajo). (commit `581b0ab`)

### Quirk del USDT de Celo descubierto

El token `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` NO es el USDT real de Tether — es un wrapper no-estándar con un fee de transferencia embebido del **~1.5%** que va a un Community Fund (`0x000000000000000000000000000000000Ce106A5`) y rebatea ~13 raw al sender. Esto significa que cada stake de $0.10 que hace un user en Arena se queda con ~$0.0965 USDT neto.

**Consecuencias prácticas**:

- `scripts/recover-treasury-funds.ts --amount X` falla con amounts chicos por el gas internal del token que excede el allowance default de viem. **Iteración en chunks chicos** (0.10 → 0.07 → 0.05 → 0.025 → 0.01 USDT) funciona.
- La economía de Arena tiene que predecrementar el stake real por ~1.5%, o absorber el fee como costo, o cambiar a un token sin fee (USDC en Celo Mainnet puede tener quirks similares — verificar).

### Pendientes para la próxima sesión

1. **2-device match pairing test**: smoke real con dos devices físicos MiniPay. Necesita otro operador (la última prueba con tu solo device no garantiza el match real).
2. **Quitar logs `[HexArena:diag]` temporales** en server y cliente (dejados en commit `882e791` y `bc41166` para diagnosticar — ahora es momento de removerlos cuando confirmes el fix).
3. **talent.app registration** (Prueba de Ship).
4. **Submisión a MiniPay catalogue Stage 1** (intake form).

### Recursos

- Repo: https://github.com/opitradingacademy/hexarena (rama `main`). Push con `bash scripts/push-with-token.sh main`.
- `apps/server` en Railway: https://hexarenaserver-production.up.railway.app
- `apps/web` en Vercel: https://web-taupe-alpha-23.vercel.app (alias de `web-taupe-alpha-23.vercel.app`)
- `ArenaSettlement.sol` en Celo Mainnet: `0x108E012C3B12421f216cA5C2C59770c34653e1d0`, verificado en https://celoscan.io/address/0x108e012c3b12421f216ca5c2c59770c34653e1d0
- Token de settlement: USDT de Celo `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` (con quirk fee ~1.5% — ver arriba)

## Patrones canónicos de la base

Estos se aplicaron 3+ veces en distintos lugares — son la fuente de verdad para futuras Mini Apps:

1. **Resolver wallet en cada socket reconnect**, NO en module-load. MiniPay inyecta `window.ethereum` asincrónicamente. (ver lib/socketSingleton.ts)
2. **Read on-chain**: `eth_call` por el provider inyectado, NUNCA un RPC público HTTP. La CORS bloquea forno.celo.org desde dentro del WebView.
3. **Wallet address**: jerárquico `selectedAddress → eth_accounts → eth_requestAccounts`. `selectedAddress` no requiere RPC, gana en 0ms.
4. **Send tx**: viem `createWalletClient` + `custom(window.ethereum)` + `{ account, to, data, feeCurrency: USDT_ADAPTER, type: 'cip64' }`. NUNCA raw eth_sendTransaction manual. `feeCurrency` es la dirección **del adapter**, NO del token.
5. **Receipt**: el client fetchea el receipt con el provider-stub que firmó la tx (instantáneo). El server valida estructuralmente. NUNCA polling del server contra RPCs públicos (2-30s de lag). Si el local fetch falla, **delegar al server slow-path** omitiendo el campo `receipt` en el POST `/api/deposit`.
6. **Env validation**: 32-byte (64-hex-char) addresses son CERRADAS — fail loud al boot, no dejar propagar a on-chain reverts.
7. **CORS**: el HTTP handler necesita su propio Access-Control-Allow-Origin + OPTIONS preflight. Socket.IO's CORS no se extiende a HTTP.
8. **Matchmaker**: NUNCA hacer match de un userId consigo mismo. Filtrar self-entries siempre.
9. **Proveedor multi-RPC**: viem `fallback([...])` solo cae a la siguiente RPC si hay error de transporte, NO si devuelve `null`. Para poll de receipts nuevos, hacer `Promise.allSettled` sobre clients separados y tomar el primer non-null.
10. **Railway + SQLite persistente**: para que el ledger sobreviva redeploys, setear `SQLITE_PATH=/data/<file>.db` con un volume de Railway montado en `/data`. El default `/tmp/<file>.db` es writable pero **efímero** (se borra cada redeploy). Log de validación al boot: `using sqlite ledger at <path>`. **Free tier NO soporta volumes** — mínimo Hobby. Storage incluido en Hobby (1 GB) alcanza para ~400k matches acumulados con el schema actual (~2.5 KB/partida en disco).

## Reglas de MiniPay para Mini Apps (HARD RULES — lint gate + hand-reviewed)

Estas reglas son obligatorias para cualquier Mini App. Hay un lint gate que las verifica automáticamente: `apps/web/bin/check-copy-rules.ts`. **Pero los criterios técnicos NO se chequean automáticamente** — requieren code review.

### Copy rules (chequeadas por lint)

- Nunca "gas"/"gas fee" → "comisión de red" / "network fee".
- Nunca "crypto"/"crypto token" → "stablecoin" / "dólar digital".
- Nunca "onramp"/"buy crypto" → "deposit".
- Nunca "offramp"/"sell crypto" → "withdraw".
- Nunca mostrar CELO ni direcciones `0x` como identificador principal — balances siempre en USD, addresses truncadas `0x1234…5678`.
- Solo USDT/USDC/USDm en scope de la Mini App.

### Technical rules (chequeadas por review)

- **Send tx shape**: `viem.createWalletClient({ chain: celo, transport: custom(window.ethereum) })` + `sendTransaction({ account, to, data, feeCurrency: USDT_ADAPTER, type: 'cip64' })`. Nada más.
  - `feeCurrency` = dirección del adapter, NO del token. USDT adapter: `0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72`.
  - `type: 'cip64'` (string abstracto de viem), NUNCA `'0x7b'`, NUNCA `0`.
  - NO `maxFeePerGas`/`maxPriorityFeePerGas`/`gas`/`gasPrice` explícitos.
- **Read on-chain**: `eth_call` por el provider inyectado, NUNCA un RPC público HTTP.
- **Wallet address**: jerárquico `selectedAddress → eth_accounts → eth_requestAccounts`. Resolver en cada `auth` callback del socket, no al module-load.
- **Receipt fetching**: client-side, con el mismo provider-stub que firmó la tx. Server valida estructuralmente sin RPC polling. Si el fetch local falla o devuelve null, **delegar al server slow-path** sin el campo `receipt`.
- **Env vars**: validar al boot que las addresses sean de 20 bytes (40 hex chars). Un valor de 64 hex chars es una address corrupta y debe fail loudly.
- **CORS**: HTTP handlers necesitan Access-Control-Allow-Origin + OPTIONS preflight handler.
- **Bundle size**: JS de `apps/web` debe pesar <2MB — hay un gate (`check:bundle-size`) que lo mide contra un build real. Al cierre de la sesión de hoy: a verificar después del cleanup.

### Direcciones de referencia (Mainnet, chainId 42220)

| Token | Token address                                | Adapter address (feeCurrency)                |
| ----- | -------------------------------------------- | -------------------------------------------- |
| USDT  | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | `0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72` |
| USDC  | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | `0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B` |
| USDm  | `0x765DE816845861e75A25fCA122bb6898B8B1282a` | (el mismo, 18 decimales)                     |

## Comandos útiles

```bash
pnpm install                          # instalar deps del monorepo
pnpm test                             # correr todos los tests (Vitest)
pnpm --filter @hexarena/web dev       # levantar la Mini App en localhost:3000
cd packages/contracts && forge test   # tests del contrato
bash scripts/push-with-token.sh main  # push (no dejar token en git config)
vercel --prod                        # deploy web a producción
```

## Convenciones de trabajo con SDD (para retomar mañana)

- Delivery strategy: **PRs encadenados** (por el tamaño del cambio, 3500-5000+ líneas si fuera todo junto).
- Cada PR se delega a un sub-agente `sdd-apply` con alcance acotado a una fase del `tasks.md`, que debe leer `sdd/hexarena-mvp/apply-progress` de Engram antes de empezar y MERGEAR (no sobreescribir) su progreso al guardar.
- Antes de empezar cualquier PR, leer `state.yaml` para saber la fase actual.
- **Always leave a diagnostic breadcrumb** cuando el bug pueda no estar en el código (cache de browser, race condition). Los `[HexArena:diag]` console.logs son un patrón de esta sesión que vale la pena institucionalizar.

## Debugging Arena: qué NO hacer — lessons learned

1. **NO iterar sobre 5+ shapes de tx confiando solo en el error message**. El error `execution reverted, data: 0x` es ambiguo. Después de 3 iteraciones, pedir al user que pegue el tx_hash y verificar en CeloScan si la tx está on-chain.
2. **NO usar `forno.celo.org` como RPC primario**. Latencia variable (2-30s). Usar `celo-rpc.publicnode.com` como primario + `forno.celo.org` como fallback.
3. **NO hacer polling del receipt en el server** cuando el client puede hacerlo con el provider-stub. El provider-stub ve la tx inmediatamente.
4. **NO aceptar addresses de 64 hex chars como válidas** — son 32 bytes (corruptas). Validar 20 bytes (40 hex chars) al boot.
5. **NO omitir CORS headers en HTTP handlers** pensando que Socket.IO's CORS cubre todo. Cubre solo Socket.IO, no `/api/*` REST endpoints.
6. **NO desplegar un fix sin un test que cubra exactamente el bug que se arregla**. El fix del socketSingleton (`7dd3c0c`) tiene 2 tests que cubren el caso, pero los actualicé porque cambié la API (usar promise en `auth`); deben escribirse los tests nuevos del async `auth` provider.
7. **NO confiar en una lectura module-load de `window.ethereum` en MiniPay** — el provider llega async. Resolver en cada operación que lo necesite (socket reconnect, balance query, etc).
8. **NO usar `fallback` de viem cuando la respuesta puede ser null legítimo** — para receipt polling, `Promise.allSettled` paralelo sobre clients separados.
