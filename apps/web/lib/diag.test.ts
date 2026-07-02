import { describe, expect, it, vi } from "vitest";
import { createDiagLog } from "./diag";

describe("createDiagLog", () => {
  it("captures entries passed through log()", () => {
    const { entries, log } = createDiagLog();
    log("A.isMiniPay", { isMiniPay: true });
    log("B.walletAddress", { walletAddress: "0xabc" });
    expect(entries).toEqual([
      { label: "A.isMiniPay", payload: JSON.stringify({ isMiniPay: true }) },
      { label: "B.walletAddress", payload: JSON.stringify({ walletAddress: "0xabc" }) },
    ]);
  });

  it("also writes the same entries to console.log (DevTools mirror)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { log } = createDiagLog();
    log("A.isMiniPay", { isMiniPay: true });
    expect(spy).toHaveBeenCalledWith("[HexArena:diag]", "A.isMiniPay", { isMiniPay: true });
    spy.mockRestore();
  });

  it("stringifies circular values gracefully", () => {
    const { entries, log } = createDiagLog();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    log("circular", circular);
    expect(entries[0].label).toBe("circular");
    expect(entries[0].payload).toContain("[object"); // JSON.stringify falls back
  });

  it("renders empty payload as empty string when value is undefined", () => {
    const { entries, log } = createDiagLog();
    log("bare", undefined);
    expect(entries[0]).toEqual({ label: "bare", payload: "" });
  });
});
