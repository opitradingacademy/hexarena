import { describe, expect, it } from "vitest";
import { applyCorsHeaders } from "./cors";

describe("applyCorsHeaders", () => {
  it("sets the standard CORS headers for a same-origin request", () => {
    const headers: Record<string, string | string[] | undefined> = {};
    applyCorsHeaders(headers, "*");
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Access-Control-Allow-Methods"]).toMatch(/POST/);
    expect(headers["Access-Control-Allow-Headers"]).toMatch(/content-type/);
    expect(headers["Access-Control-Allow-Headers"]).toMatch(/x-wallet-address/);
  });

  it("echoes the request origin when explicitly allowed", () => {
    const headers: Record<string, string | string[] | undefined> = {};
    applyCorsHeaders(headers, "https://web-taupe-alpha-23.vercel.app");
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://web-taupe-alpha-23.vercel.app");
  });
});
