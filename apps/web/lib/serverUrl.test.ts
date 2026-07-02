import { afterEach, describe, expect, it, vi } from "vitest";
import { getServerUrl } from "./serverUrl";

describe("getServerUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to localhost:3001 in dev when unset", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_URL", "");
    expect(getServerUrl()).toBe("http://localhost:3001");
  });

  it("uses NEXT_PUBLIC_SERVER_URL when set", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_URL", "https://hexarenaserver-production.up.railway.app");
    expect(getServerUrl()).toBe("https://hexarenaserver-production.up.railway.app");
  });
});
