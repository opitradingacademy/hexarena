/**
 * Recupera fondos de USDT atascados en la treasury operativa (Arena) hacia
 * una dirección de destino, firmando un `transfer()` ERC-20 con la
 * OPERATOR_PRIVATE_KEY.
 *
 * Por qué existe: varios depósitos de prueba de $0.10 USDT llegaron a la
 * treasury (0x34d5d015B4805E985619D0F4aaCb6343a6457fF2) pero no se
 * acreditaron en el ledger interno porque el cliente nunca completó el
 * POST /api/deposit en esos intentos. La plata sigue en la wallet,
 * controlada por esta misma private key — no está perdida, solo requiere
 * un transfer manual de vuelta.
 *
 * Uso:
 *   OPERATOR_PRIVATE_KEY=0x... npx tsx scripts/recover-treasury-funds.ts \
 *     --to 0xDestinatario... --amount 0.30
 *
 *   Agregá --confirm para enviar la tx de verdad. Sin --confirm corre en
 * modo dry-run (solo valida y muestra qué haría, no firma nada).
 *
 * La private key NUNCA debe vivir en el repo. Pasala por env var, o por
 * un archivo listado en .gitignore (.env.operator, .operator-key,
 * scripts/*.secret*) que vos mismo cargues antes de correr el script.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, encodeFunctionData, http, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { FEE_CURRENCY_ADAPTER, SETTLEMENT_TOKEN_ADDRESS } from "@hexarena/shared/chain";

/**
 * Carga OPERATOR_PRIVATE_KEY desde .env en la raíz del repo si no está ya
 * en el entorno. No hay dependencia de dotenv en el monorepo — parseo
 * mínimo, solo esta clave.
 */
function loadOperatorKeyFromDotenv(): void {
  if (process.env.OPERATOR_PRIVATE_KEY) return;
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(scriptDir, "..");
  for (const filename of [".env.operator", ".operator-key", ".env"]) {
    const envPath = join(repoRoot, filename);
    if (!existsSync(envPath)) continue;
    const match = readFileSync(envPath, "utf8").match(/^OPERATOR_PRIVATE_KEY=(.+)$/m);
    if (match) {
      process.env.OPERATOR_PRIVATE_KEY = match[1].trim().replace(/^["']|["']$/g, "");
      return;
    }
  }
}

const DEFAULT_RPC_URL = "https://celo-rpc.publicnode.com";
const SETTLEMENT_TOKEN_DECIMALS = 6; // USDT en Celo

function parseArgs(argv: string[]) {
  const args: { to?: string; amount?: string; confirm: boolean } = { confirm: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--to") args.to = argv[++i];
    else if (argv[i] === "--amount") args.amount = argv[++i];
    else if (argv[i] === "--confirm") args.confirm = true;
  }
  return args;
}

function assertAddress(value: string | undefined, label: string): Address {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(
      `${label} inválido: '${value}'. Se espera 0x + 40 hex chars (20 bytes).`,
    );
  }
  return value.toLowerCase() as Address;
}

async function main() {
  loadOperatorKeyFromDotenv();
  const args = parseArgs(process.argv.slice(2));

  const to = assertAddress(args.to, "--to");
  if (!args.amount) {
    throw new Error("Falta --amount (en USDT, ej: 0.30)");
  }
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`--amount inválido: '${args.amount}'`);
  }

  const privateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error(
      "OPERATOR_PRIVATE_KEY no está seteada. Pasala como env var, nunca la " +
        "hardcodees en este archivo ni en uno trackeado por git.",
    );
  }

  const tokenAddress = SETTLEMENT_TOKEN_ADDRESS[celo.id];
  if (!tokenAddress) {
    throw new Error(`No hay settlement token configurado para chainId ${celo.id}`);
  }
  const feeCurrency = FEE_CURRENCY_ADAPTER[celo.id];
  if (!feeCurrency) {
    throw new Error(`No hay fee-currency adapter configurado para chainId ${celo.id}`);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const raw = parseUnits(amount.toFixed(SETTLEMENT_TOKEN_DECIMALS), SETTLEMENT_TOKEN_DECIMALS);

  console.log("Recover treasury funds — plan:");
  console.log(`  from (operator/treasury): ${account.address}`);
  console.log(`  to:                       ${to}`);
  console.log(`  amount:                   ${amount} USDT (raw: ${raw})`);
  console.log(`  token contract:           ${tokenAddress}`);
  console.log(`  mode:                     ${args.confirm ? "EJECUTAR (--confirm)" : "DRY-RUN (sin --confirm)"}`);

  if (!args.confirm) {
    console.log("\nDry-run: no se firmó ninguna transacción. Agregá --confirm para enviarla de verdad.");
    return;
  }

  const rpcUrl = process.env.CELO_MAINNET_RPC_URL || DEFAULT_RPC_URL;
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: http(rpcUrl),
  });

  const TRANSFER_ABI = [
    {
      type: "function",
      name: "transfer",
      stateMutability: "nonpayable",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ name: "", type: "bool" }],
    },
  ] as const;

  const data = encodeFunctionData({
    abi: TRANSFER_ABI,
    functionName: "transfer",
    args: [to, raw],
  });

  // La treasury solo tiene USDT, no CELO — igual que en el flujo de MiniPay,
  // pagamos el gas en USDT vía fee abstraction (feeCurrency + CIP-64).
  const txHash = await walletClient.sendTransaction({
    account,
    chain: celo,
    to: tokenAddress,
    data,
    feeCurrency,
    type: "cip64",
  });

  console.log(`\nTx enviada: ${txHash}`);
  console.log(`Ver en CeloScan: https://celoscan.io/tx/${txHash}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
