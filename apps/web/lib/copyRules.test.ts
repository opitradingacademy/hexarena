import { describe, expect, it } from "vitest";
import { findCopyRuleViolations } from "./copyRules";

describe("findCopyRuleViolations", () => {
  it("flags 'gas fee' as a banned term", () => {
    const violations = findCopyRuleViolations('estimated gas fee: $0.01');
    expect(violations).toContain("gas");
  });

  it("flags a raw 0x address", () => {
    const violations = findCopyRuleViolations("Sent to 0x1234567890abcdef1234567890abcdef12345678");
    expect(violations).toContain("0x-address");
  });

  it("flags the CELO ticker", () => {
    const violations = findCopyRuleViolations("Balance: 12 CELO");
    expect(violations).toContain("CELO");
  });

  it("returns no violations for compliant copy", () => {
    const violations = findCopyRuleViolations("Balance: $4.20 — network fee: $0.01");
    expect(violations).toEqual([]);
  });
});
