# HexArena

Othello sobre tablero hexagonal para MiniPay (Celo). Ver `proyecto.md` para el GDD completo (visión de producto a largo plazo — no todo está en el MVP).

## Estado del proyecto

Desarrollo guiado por SDD (Spec-Driven Development), modo **hybrid** (artefactos en `openspec/` + Engram). Cambio activo: **`hexarena-mvp`**.

- Artefactos SDD: `openspec/changes/hexarena-mvp/` (proposal, design, specs/, tasks.md, state.yaml).
- Estado del DAG: `openspec/changes/hexarena-mvp/state.yaml` — siempre revisar ahí antes de asumir qué fase sigue.
- Progreso de implementación detallado: Engram, topic_key `sdd/hexarena-mvp/apply-progress`.

**Al día de hoy (2026-07-03)**: PR1-PR5 de 5 completados. Todo deployado y en producción. **Arena flow end-to-end implementado y production-ready**, validado 1-device en MiniPay físico (tx firmada, receipt confirmado en CeloScan, modal cierra correctamente). Pendiente: 2-device match pairing y operator treasury address real (actualmente self-transfer porque la env está apuntando a la wallet del user).

- Repo público: https://github.com/opitradingacademy/hexarena (rama `main`). Push requiere `bash scripts/push-with-token.sh main` (token en `.github-token`, gitignored — no hay credenciales persistentes en `git config`).
- `apps/server` en Railway: https://hexarenaserver-production.up.railway.app
- `apps/web` en Vercel: https://web-taupe-alpha-23.vercel.app (deployado vía CLI con `vercel --prod`, config en `vercel.json` de la raíz para que Vercel entienda el monorepo pnpm — root del proyecto Vercel es la raíz del repo, no `apps/web`, porque necesita ver el lockfile completo).
- `ArenaSettlement.sol` en Celo Mainnet: `0x108E012C3B12421f216cA5C2C59770c34653e1d0`, verificado en Celoscan (https://celoscan.io/address/0x108e012c3b12421f216ca5c2c59770c34653e1d0). Token de settlement: USDT real (`0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e`, NO la dirección de fee-abstraction de MiniPay).
- Integración e2e real (Casual + Arena) probada con dos clientes de socket reales, 159/159 tests Vitest.

**Resuelto (2026-07-03)**: el bug histórico del balance USDT en $0.00 y el flow completo de Arena deposit. Cinco capas de bugs concurrentes atacadas en commits `c1495c5` → `6f9ebb9` → `9275b5f` → `da67002` → `2710924` → `3e4d5ad` → `563ca3f` → `df3e5c0` → `db281d0` → `2dccefd` → `ef3e9a2` → `194d759` → `871610f` → `6502182`: (1) `useIsMiniPay` con `useState(false)` quedaba stale en mount, (2) `getWalletAddress` no leía `provider.selectedAddress` antes que `eth_requestAccounts` (este último rompe en el provider-stub del WebView), (3) `getUsdtBalance` usaba viem+forno.celo.org inalcanzable por CORS desde el WebView, (4) hardcoded `balanceUSD = 0` en MatchmakingScreen que bloqueaba el flujo Arena, (5) treasury address corrupta (32 bytes) propagándose a on-chain reverts, (6) CORS faltante en el HTTP handler del server bloqueando fetch cross-origin desde MiniPay WebView, (7) propagación lenta de txs nuevas en public RPCs (forno, publicNode) requiriendo que el client fetchee el receipt localmente. Ver `openspec/changes/hexarena-mvp/tasks.md` para el detalle.

**Patrones canónicos de la base** (estos se aplicaron 3+ veces en distintos lugares — son la fuente de verdad para futuras Mini Apps):

1. **Read on-chain**: `eth_call` por el provider inyectado, NUNCA un RPC público HTTP. La CORS bloquea forno.celo.org desde dentro del WebView.
2. **Wallet address**: jerárquico `selectedAddress → eth_accounts → eth_requestAccounts`. `selectedAddress` no requiere RPC, gana en 0ms.
3. **Send tx**: viem `createWalletClient` + `custom(window.ethereum)` + `{ account, to, data, feeCurrency: USDT_ADAPTER, type: 'cip64' }`. NUNCA raw eth_sendTransaction manual.
4. **Receipt**: el client fetchea el receipt con el provider-stub que firmó (instantáneo). El server valida estructuralmente. NUNCA polling del server contra RPCs públicos (2-30s de lag).
5. **Env validation**: 32-byte (64-hex-char) addresses son CERRADAS — fail loud al boot, no dejar propagar a on-chain reverts.
6. **CORS**: el HTTP handler necesita su propio Access-Control-Allow-Origin + OPTIONS preflight. Socket.IO's CORS no se extiende a HTTP.

## Alcance del MVP

Casual 1v1 + Arena (apuestas). **Fuera de alcance**: torneos, temporadas, habilidades especiales (quedan para v2, están en el GDD pero no en `hexarena-mvp`).

## Stack

Monorepo con pnpm workspaces:

- `packages/shared` — dominio puro del motor de juego (coordenadas axiales, captura en 6 direcciones, sin I/O) + tipos de protocolo WS + placeholder de tipos chain.
- `apps/server` — Node.js + Socket.IO, autoridad del juego (turnos, reloj Blitz, reconexión con 30s de gracia), ledger interno en memoria (invariantes: balance nunca negativo, tx_hash único, hold/release atómico). POST /api/deposit endpoint valida receipts de Arena stake deposit.
- `packages/contracts` — Foundry. `ArenaSettlement.sol`: fondeo pre-fondeado, `settle()` idempotente por matchId, `onlyOperator`, pause/withdraw `onlyOwner`. NO recalcula el rake on-chain (confía en el `amount` del backend).
- `apps/web` — Next.js (App Router) Mini App para MiniPay. Detección `isMiniPay()`, fee abstraction vía viem (única lib con soporte nativo de `feeCurrency` + `type: 'cip64'`), 4 pantallas (Dashboard, Matchmaking, Tablero, Resultado/Historial).

Test runner: Vitest (raíz del monorepo) + Foundry para contratos. Strict TDD Mode activo — seguir RED-GREEN-REFACTOR.

## Reglas de negocio de Arena (ya decididas, no renegociar sin nueva confirmación del usuario)

- House rake: **20%** del pool total (0.02 por cada 0.10 apostado) en toda victoria decisiva.
- Ventana de gracia por desconexión: **30 segundos** exactos, fijo (no configurable en MVP).
- Empate: reembolso **menos** house rake (mismo 20%), solo ledger, sin llamada on-chain.
- Partida VOID por error de servidor: reembolso **total**, sin rake.

## Reglas MiniPay para Mini Apps (HARD RULES — lint gate + hand-reviewed)

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
- **Wallet address**: jerárquico `selectedAddress → eth_accounts → eth_requestAccounts`.
- **Receipt fetching**: client-side, con el mismo provider-stub que firmó la tx. Server valida estructuralmente sin RPC polling.
- **Env vars**: validar al boot que las addresses sean de 20 bytes (40 hex chars). Un valor de 64 hex chars es una address corrupta y debe fail loudly.
- **CORS**: HTTP handlers necesitan Access-Control-Allow-Origin + OPTIONS preflight handler.
- **Bundle size**: JS de `apps/web` debe pesar <2MB — hay un gate (`check:bundle-size`) que lo mide contra un build real. Al cierre de PR5: 1.09MB.

### Direcciones de referencia (Mainnet, chainId 42220)

| Token | Token address                                | Adapter address (feeCurrency)                |
| ----- | -------------------------------------------- | -------------------------------------------- |
| USDT  | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | `0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72` |
| USDC  | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | `0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B` |
| USDm  | `0x765DE816845861e75A25fCA122bb6898B8B1282a` | (el mismo, 18 decimales)                     |

## Estado de Arena end-to-end

| Componente                                    | Estado                                                  |
| --------------------------------------------- | ------------------------------------------------------- |
| Dashboard balance USDT                        | ✅ Verificado en device                                 |
| StakeSelector chips                           | ✅ Verificado en device                                 |
| StakeConfirmDialog modal                      | ✅ Verificado en device                                 |
| Firmar tx con `type: 'cip64'` + `feeCurrency` | ✅ Verificado en device (CIP-64 type 0x7b en CeloScan)  |
| POST /api/deposit con receipt                 | ✅ Verificado en device (modal cierra, ledger acredita) |
| Match pairing (2 devices)                     | ⏳ Pendiente test con 2do device                        |
| `settle()` post-match                         | ⏳ Implementado pero no validado en device              |

### Variables de entorno requeridas

**En Railway** (server):

- `OPERATOR_PRIVATE_KEY` — key del operador (default: deriva la treasury address si no está `ARENA_TREASURY_ADDRESS`).
- `ARENA_TREASURY_ADDRESS` — address que recibe los stakes de los usuarios (40 hex chars exactos). Si no se setea, el server falla al boot con mensaje claro.
- `ARENA_CORS_ORIGIN` (opcional) — origin permitido para CORS. Default: `https://web-taupe-alpha-23.vercel.app`.
- `CELO_MAINNET_RPC_URL` (opcional) — RPC público. Default: `https://celo-rpc.publicnode.com` con fallback a `https://forno.celo.org`.

**En Vercel** (web):

- `NEXT_PUBLIC_ARENA_TREASURY_ADDRESS` — mismo valor que en Railway.
- `NEXT_PUBLIC_SERVER_URL` — URL base del API server. Default: `http://localhost:3001`.

## Proof of Ship (programa de builder de Celo)

Referencia: `~/.claude/skills/celopedia-skill/references/proof-of-ship.md`. Requisitos duros para calificar a premios: contrato en Celo Mainnet, repo público en GitHub con commits reales, app live, registro en talent.app. Es mensual — no hay apuro de fecha límite fija. HexArena (juego con prize pool en USDm) es Tier 1 (máximo fit).

## Pendientes manuales

1. **Operator treasury real**: configurar `ARENA_TREASURY_ADDRESS` y `NEXT_PUBLIC_ARENA_TREASURY_ADDRESS` con una address de operator separada del user wallet (no la misma).
2. **talent.app**: registrar el proyecto (Proof of Ship) — acción manual del usuario.
3. **Submission a MiniPay catalogue** (Stage 2: UI screenshot 360×640, PageSpeed ≥90, ToS/Privacy, 24h SLA) — fuera del scope MVP pero es el siguiente paso natural.
4. **2-device match pairing test** — confirmar que el server empareja correctamente dos usuarios en Arena.

## Wireframes

Las 4 pantallas están especificadas en Markdown dentro de `openspec/changes/hexarena-mvp/design.md` (layout, jerarquía de componentes, estados). El usuario las replica manualmente en `tools/OpenPencil-0.7.4-x64-win.exe` — esa app no tiene API/CLI, no intentar automatizarla.

## Comandos útiles

```bash
pnpm install                          # instalar deps del monorepo
pnpm test                             # correr todos los tests (Vitest)
pnpm --filter @hexarena/web dev       # levantar la Mini App en localhost:3000
cd packages/contracts && forge test   # tests del contrato
bash scripts/push-with-token.sh main  # push (no dejar token en git config)
vercel --prod                        # deploy web a producción (alias web-taupe-alpha-23.vercel.app)
```

## Convenciones de trabajo con SDD (para retomar mañana)

- Delivery strategy acordada: **PRs encadenados** (por el tamaño estimado del cambio, 3500-5000+ líneas si fuera todo junto).
- Cada PR se delega a un sub-agente `sdd-apply` con alcance acotado a una fase del `tasks.md`, que debe leer `sdd/hexarena-mvp/apply-progress` de Engram antes de empezar y MERGEAR (no sobreescribir) su progreso al guardar.
- No hay `git init` todavía en esta carpeta — pendiente cuando el usuario lo pida explícitamente.

## Debugging Arena: qué NO hacer

Si en el futuro alguien trabaja en flow similar (signing + on-chain + server validation), evitar estos patrones que ya demostramos rotos:

1. **NO** iterar sobre 5+ shapes de tx confiando solo en el error message. El error `execution reverted, data: 0x` es ambiguo y puede significar cualquier cosa. Después de 3 iteraciones, pedir al user que pegue el tx_hash y verificar en CeloScan si la tx está on-chain.
2. **NO** usar `forno.celo.org` como RPC primario. Su latencia de propagación para txs nuevas es variable (2-30s). Usar `celo-rpc.publicnode.com` como primario.
3. **NO** hacer polling del receipt en el server cuando el client puede hacerlo con el provider-stub que firmó. El provider-stub ve la tx inmediatamente.
4. **NO** aceptar addresses de 64 hex chars como válidas — son 32 bytes (corruptas). Validar 20 bytes (40 hex chars) al boot.
5. **NO** omitir CORS headers en HTTP handlers pensando que Socket.IO's CORS cubre todo. Cubre solo Socket.IO, no `/api/*` REST endpoints.
6. **NO** desplegar un fix sin un test que cubra exactamente el bug que se arregla. El fix de la dirección corrupta se verificó con `apps/server/indexEnv.test.ts` (7 tests que cubren exactamente el caso del 32-byte address).
