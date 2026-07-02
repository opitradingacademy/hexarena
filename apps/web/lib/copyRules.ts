/**
 * MiniPay copy-rule checker — spec "Crypto/Gas-Free Copy".
 * Scans a text string for banned crypto/gas terminology and returns the
 * set of violated rule ids. Used both as a unit-tested pure function and by
 * the `scanCopyRules` build-time script (bin/check-copy-rules.ts) that walks
 * app/ and components/ source files.
 */
export type CopyRuleViolation = "gas" | "crypto" | "0x-address" | "CELO";

const RULES: Array<{ id: CopyRuleViolation; pattern: RegExp }> = [
  { id: "gas", pattern: /\bgas(\s?fee)?\b/i },
  { id: "crypto", pattern: /\bcrypto(\s?token)?\b/i },
  { id: "0x-address", pattern: /\b0x[0-9a-fA-F]{6,}\b/ },
  { id: "CELO", pattern: /\bCELO\b/ },
];

export function findCopyRuleViolations(text: string): CopyRuleViolation[] {
  return RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.id);
}
