#!/usr/bin/env node
/**
 * Bundle Size Budget gate (minipay-client spec "Bundle Size Budget"):
 * sums all JS emitted under .next/static and fails if it is >= 2MB.
 * Run AFTER `next build` (via `pnpm --filter @hexarena/web run build && node bin/check-bundle-size.ts`).
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BUDGET_BYTES = 2 * 1024 * 1024;
const STATIC_DIR = join(process.cwd(), ".next", "static");

function collectJsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...collectJsFiles(full));
    } else if (full.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

function main() {
  let totalBytes = 0;
  try {
    const files = collectJsFiles(STATIC_DIR);
    totalBytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
  } catch {
    console.error(`No build output found at ${STATIC_DIR} — run "next build" first.`);
    process.exit(1);
  }

  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  if (totalBytes >= BUDGET_BYTES) {
    console.error(`Bundle size ${totalMB}MB exceeds the 2MB budget.`);
    process.exit(1);
  }
  console.log(`Bundle size OK: ${totalMB}MB (budget 2MB).`);
}

main();
