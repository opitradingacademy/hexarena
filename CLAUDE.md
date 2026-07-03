# HexArena

Othello sobre tablero hexagonal para MiniPay (Celo). Ver `proyecto.md` para el GDD completo.

## Estado del proyecto

Desarrollo guiado por SDD (Spec-Driven Development), modo **hybrid** (artefactos en `openspec/` + Engram). Cambio activo: **`hexarena-mvp`**.

- Artefactos SDD: `openspec/changes/hexarena-mvp/` (proposal, design, specs/, tasks.md, state.yaml).
- Estado del DAG: `openspec/changes/hexarena-mvp/state.yaml` — siempre revisar ahí antes de asumir qué fase sigue.
- Progreso de implementación detallado: Engram, topic_key `sdd/hexarena-mvp/apply-progress`.

**Al día de hoy (2026-07-03, cierre de sesión de debugging extendida):**

- PR1–PR5 completados, deployados en producción.
- Operator treasury address real configurada en Railway: `0x34d5d015B4805E985619D0F4aaCb6343a6457fF2` (separada de la wallet del user).
- 169/169 tests Vitest verde al cierre de cada PR; serie de fixes de esta sesión movió la suite a **186/186 verde**.

### Estado del Arena deposit flow al cierre

**Causa raíz del modal-loop, finalmente identificada y arreglada en commit `7dd3c0c` (ver "Hallazgos críticos" abajo):**

`socketSingleton.ts` cacheaba `walletAddress` SOLO en module-load. MiniPay inyecta `window.ethereum` asincrónicamente (evento `ethereum#initialized`); la primera lectura fallaba al module-load y quedaba en `undefined` para siempre. Cada socket reconnect mandaba `auth` sin wallet → server caía al fallback `socket.id` (que cambia cada reconnect) → el matchmaker evaluaba `balanceOf(store, $randomSocketId)` que siempre era 0 → tiraba `INSUFFICIENT_BALANCE` → el cliente reabría el modal. Curl `/api/balance` siempre devolvía el balance correcto (esa ruta NO depende del socket auth). Por eso los fixes de los días anteriores fallaban en parecer arreglar el problema.

**El fix definitivo** (`7dd3c0c`): `getSocket()` ahora resuelve la wallet en cada `auth` callback. socket.io-client llama `auth` en cada reconnect, así que después del primer intento exitoso el `userId` se mantiene estable a `0x5288AcFd5c2371f880b4A2BBEE8aF647bD9a051b` (tu wallet MiniPay) y todos los join_queue evalúan el balance correcto.

### Hallazgos críticos de esta sesión de debugging

Cada uno es un bug real que hubiera roto el flow en device físico. Los 4 primeros síntomas son reales; solo el #5 es la causa raíz definitiva.

1. **MiniPay `eth_getTransactionReceipt` returns null/throws** incluso para tx minadas, porque el provider-stub del WebView tiene una vista local atrasada del chain state. Cliente delega al server slow-path de 40s con multi-RPC polling. (commits `c1495c5`, `c8fe73c`)
2. **Public RPC propagation lag** (publicNode/forno) de 2-30s para tx recién minadas. Server bypasses fallback-sequencial y hace poll paralelo contra múltiples RPCs (`primaryClient` + `fornoClient`). (commit `8774eba`)
3. **`MemoryLedgerStore` perdía el balance en cada redeploy** de Railway. Reemplazado por `SqliteLedgerStore` con `better-sqlite3`. Default `/tmp/hexarena.db` (writable pero volátil); para persistencia real setear `SQLITE_PATH=/data/hexarena.db` con un volume montado. (commit `0ef5812`)
4. **`Matchmaker.join()` matcheaba al user consigo mismo** cuando su entry anterior seguía en la queue (porque `cancel_queue` solo se dispara en user action, no en socket disconnect). Filtrar self-entries en el lookup. (commit `66a15e2`)
5. **La causa raíz definitiva**: `socketSingleton.ts` cacheaba `walletAddress` en module-load — reescrito para resolverlo async en cada reconnect. (commit `7dd3c0c`)

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

1. **Persistir SQLite en Railway volume**: setear `SQLITE_PATH=/data/hexarena.db` con un volume en `/data`. Sin esto, cada redeploy borra el balance acreditado. Es el bloqueador #1 del MVP.
2. **2-device match pairing test**: smoke real con dos devices físicos MiniPay. Necesita otro operador (la última prueba con tu solo device no garantiza el match real).
3. **Quitar logs `[HexArena:diag]` temporales** en server y cliente (dejados en commit `882e791` y `bc41166` para diagnosticar — ahora es momento de removerlos cuando confirmes el fix).
4. **talent.app registration** (Prueba de Ship).
5. **Submisión a MiniPay catalogue Stage 1** (intake form).

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
