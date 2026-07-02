#!/usr/bin/env node
/**
 * Build-time gate for the MiniPay copy rules (spec "Crypto/Gas-Free Copy").
 * Walks app/ and components/ (JSX/TSX literal text — not code identifiers)
 * and fails with exit code 1 if any banned term appears in a string/JSX
 * text node. Run via `pnpm --filter @hexarena/web run lint:copy`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { findCopyRuleViolations } from "../lib/copyRules";

const ROOTS = ["app", "components"];
const EXTENSIONS = [".tsx", ".ts"];

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...walk(full));
    } else if (
      EXTENSIONS.some((ext) => full.endsWith(ext)) &&
      !full.endsWith(".test.ts") &&
      !full.endsWith(".test.tsx")
    ) {
      files.push(full);
    }
  }
  return files;
}

/** Strips // and /* *\/ comments so JSDoc rationale text (which legitimately
 * discusses "gas"/"CELO" for engineers) doesn't trip the user-facing copy
 * gate — only literal/JSX text reaching the UI should be scanned. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function main() {
  const files = ROOTS.flatMap((root) => {
    try {
      return walk(join(process.cwd(), root));
    } catch {
      return [];
    }
  });

  let failed = false;
  for (const file of files) {
    const content = stripComments(readFileSync(file, "utf-8"));
    const violations = findCopyRuleViolations(content);
    if (violations.length > 0) {
      failed = true;
      console.error(`[copy-rules] ${file}: banned terms -> ${violations.join(", ")}`);
    }
  }

  if (failed) {
    console.error("\nCopy-rule check FAILED — see minipay-client spec 'Crypto/Gas-Free Copy'.");
    process.exit(1);
  }
  console.log(`Copy-rule check passed — ${files.length} files scanned.`);
}

main();
