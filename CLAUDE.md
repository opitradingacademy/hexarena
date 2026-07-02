# HexArena

Othello sobre tablero hexagonal para MiniPay (Celo). Ver `proyecto.md` para el GDD completo (visión de producto a largo plazo — no todo está en el MVP).

## Estado del proyecto

Desarrollo guiado por SDD (Spec-Driven Development), modo **hybrid** (artefactos en `openspec/` + Engram). Cambio activo: **`hexarena-mvp`**.

- Artefactos SDD: `openspec/changes/hexarena-mvp/` (proposal, design, specs/, tasks.md, state.yaml).
- Estado del DAG: `openspec/changes/hexarena-mvp/state.yaml` — siempre revisar ahí antes de asumir qué fase sigue.
- Progreso de implementación detallado: Engram, topic_key `sdd/hexarena-mvp/apply-progress`.

**Al día de hoy (2026-07-02)**: PR1-PR4 de 5 completados (bootstrap, motor de juego, backend, contrato, frontend). Falta **PR5**: integración e2e real (conectar `apps/web` ↔ `apps/server` corriendo, conectar `settleOnChain()` al contrato desplegado) + checklist de salida a Proof of Ship (deploy a Mainnet, repo público, hosting, registro en talent.app). PR5 requiere decisiones del usuario (claves de deploy, dónde hostear) antes de arrancar.

## Alcance del MVP

Casual 1v1 + Arena (apuestas). **Fuera de alcance**: torneos, temporadas, habilidades especiales (quedan para v2, están en el GDD pero no en `hexarena-mvp`).

## Stack

Monorepo con pnpm workspaces:

- `packages/shared` — dominio puro del motor de juego (coordenadas axiales, captura en 6 direcciones, sin I/O) + tipos de protocolo WS + placeholder de tipos chain.
- `apps/server` — Node.js + Socket.IO, autoridad del juego (turnos, reloj Blitz, reconexión con 30s de gracia), ledger interno en memoria (invariantes: balance nunca negativo, tx_hash único, hold/release atómico).
- `packages/contracts` — Foundry. `ArenaSettlement.sol`: fondeo pre-fondeado, `settle()` idempotente por matchId, `onlyOperator`, pause/withdraw `onlyOwner`. NO recalcula el rake on-chain (confía en el `amount` del backend).
- `apps/web` — Next.js (App Router) Mini App para MiniPay. Detección `isMiniPay()`, fee abstraction vía viem (única lib con soporte nativo de `feeCurrency`), 4 pantallas (Dashboard, Matchmaking, Tablero, Resultado/Historial).

Test runner: Vitest (raíz del monorepo) + Foundry para contratos. Strict TDD Mode activo — seguir RED-GREEN-REFACTOR.

## Reglas de negocio de Arena (ya decididas, no renegociar sin nueva confirmación del usuario)

- House rake: **20%** del pool total (0.02 por cada 0.10 apostado) en toda victoria decisiva.
- Ventana de gracia por desconexión: **30 segundos** exactos, fijo (no configurable en MVP).
- Empate: reembolso **menos** house rake (mismo 20%), solo ledger, sin llamada on-chain.
- Partida VOID por error de servidor: reembolso **total**, sin rake.

## Reglas MiniPay (obligatorias, hay un lint gate que las verifica: `apps/web/bin/check-copy-rules.ts`)

- Nunca "gas"/"gas fee" → "comisión de red" / "network fee".
- Nunca "crypto"/"crypto token" → "stablecoin" / "dólar digital".
- Nunca mostrar CELO ni direcciones `0x` como identificador principal — balances siempre en USD.
- Solo USDT/USDC/USDm en scope de la Mini App.
- Bundle JS de `apps/web` debe pesar <2MB — hay un gate (`check:bundle-size`) que lo mide contra un build real. Al cierre de PR4: 0.77MB.
- Direcciones de fee currency en Mainnet (no inventar otras): USDm `0x765DE816845861e75A25fCA122bb6898B8B1282a` (default MiniPay), USDC adapter `0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B`, USDT adapter `0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72`.
- MiniPay solo soporta transacciones legacy (no `maxFeePerGas`/`maxPriorityFeePerGas`).

## Proof of Ship (programa de builder de Celo)

Referencia: `~/.claude/skills/celopedia-skill/references/proof-of-ship.md`. Requisitos duros para calificar a premios: contrato en Celo Mainnet, repo público en GitHub con commits reales, app live, registro en talent.app. Es mensual — no hay apuro de fecha límite fija. HexArena (juego con prize pool en USDm) es Tier 1 (máximo fit).

## Wireframes

Las 4 pantallas están especificadas en Markdown dentro de `openspec/changes/hexarena-mvp/design.md` (layout, jerarquía de componentes, estados). El usuario las replica manualmente en `tools/OpenPencil-0.7.4-x64-win.exe` — esa app no tiene API/CLI, no intentar automatizarla.

## Comandos útiles

```bash
pnpm install                          # instalar deps del monorepo
pnpm test                             # correr todos los tests (Vitest)
pnpm --filter @hexarena/web dev       # levantar la Mini App en localhost:3000
cd packages/contracts && forge test   # tests del contrato
```

## Convenciones de trabajo con SDD (para retomar mañana)

- Delivery strategy acordada: **PRs encadenados** (por el tamaño estimado del cambio, 3500-5000+ líneas si fuera todo junto).
- Cada PR se delega a un sub-agente `sdd-apply` con alcance acotado a una fase del `tasks.md`, que debe leer `sdd/hexarena-mvp/apply-progress` de Engram antes de empezar y MERGEAR (no sobreescribir) su progreso al guardar.
- No hay `git init` todavía en esta carpeta — pendiente cuando el usuario lo pida explícitamente.
