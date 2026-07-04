import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => {
    throw new Error("missing");
  }),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("../src/lib/opencode-runtime-paths.js", () => ({
  getOpencodeRuntimeDirs: () => ({
    dataDir: "/tmp/data/opencode",
    configDir: "/tmp/config/opencode",
    cacheDir: "/tmp/cache/opencode",
    stateDir: "/tmp/state/opencode",
  }),
}));

describe("google-token-cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("writes cache files with restrictive permissions", async () => {
    const { mkdir, writeFile } = await import("fs/promises");
    const { setCachedAccessToken } = await import("../src/lib/google-token-cache.js");

    await setCachedAccessToken({
      key: "account-key",
      entry: {
        accessToken: "access-token",
        expiresAt: 123,
        projectId: "project-1",
        email: "user@example.com",
      },
    });

    expect(mkdir).toHaveBeenCalledWith("/tmp/cache/opencode/status-provider", {
      recursive: true,
      mode: 0o700,
    });
    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/cache/opencode/status-provider/google-access-tokens.json",
      expect.any(String),
      { encoding: "utf-8", mode: 0o600 },
    );
  });
});
