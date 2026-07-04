import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { queryChutesStatus } from "../src/lib/chutes.js";

// Mock auth reader
vi.mock("../src/lib/opencode-auth.js", () => ({
  readAuthFile: vi.fn(),
}));

describe("queryChutesStatus", () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));

    tempDir = mkdtempSync(join(tmpdir(), "status-provider-chutes-"));
    process.env = { ...originalEnv, XDG_CONFIG_HOME: tempDir };
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when not configured", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValueOnce({});

    // Ensure env is empty
    delete process.env.CHUTES_API_KEY;

    await expect(queryChutesStatus()).resolves.toBeNull();
  });

  it("returns status data from API", async () => {
    process.env.CHUTES_API_KEY = "test-key";

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: 1000,
              used: 250,
            }),
            { status: 200 },
          ),
      ) as any,
    );

    const out = await queryChutesStatus();
    expect(out && out.success ? out.percentRemaining : -1).toBe(75);
    expect(out && out.success ? out.resetTimeIso : "").toBe("2026-01-02T00:00:00.000Z");
  });

  it("handles API errors", async () => {
    process.env.CHUTES_API_KEY = "test-key";

    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unauthorized", { status: 401 })) as any);

    const out = await queryChutesStatus();
    expect(out && !out.success ? out.error : "").toContain("Chutes API error 401");
  });

  it("sanitizes API error text before returning it", async () => {
    process.env.CHUTES_API_KEY = "test-key";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized\u001b[31m", { status: 401 })) as any,
    );

    const out = await queryChutesStatus();
    expect(out && !out.success ? out.error : "").toBe("Chutes API error 401: Unauthorized");
  });

  it("ignores repo-local provider config for secret lookup", async () => {
    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({
        provider: {
          chutes: {
            options: {
              apiKey: "{env:CHUTES_API_KEY}",
            },
          },
        },
      }),
      "utf-8",
    );

    const out = await queryChutesStatus();
    expect(out).toBeNull();
  });

  it("reads chutes api keys from trusted global config only", async () => {
    mkdirSync(join(tempDir, "opencode"), { recursive: true });
    writeFileSync(
      join(tempDir, "opencode", "opencode.json"),
      JSON.stringify({
        provider: {
          chutes: {
            options: {
              apiKey: "global-config-key",
            },
          },
        },
      }),
      "utf-8",
    );

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 1000,
            used: 250,
          }),
          { status: 200 },
        ),
    ) as any;
    vi.stubGlobal("fetch", fetchMock);

    const out = await queryChutesStatus();
    expect(out && out.success ? out.percentRemaining : -1).toBe(75);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.chutes.ai/users/me/status_usage/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer global-config-key",
        }),
      }),
    );
  });

  it("rejects arbitrary env templates in trusted global config", async () => {
    process.env.GITHUB_TOKEN = "github-secret";
    mkdirSync(join(tempDir, "opencode"), { recursive: true });
    writeFileSync(
      join(tempDir, "opencode", "opencode.json"),
      JSON.stringify({
        provider: {
          chutes: {
            options: {
              apiKey: "{env:GITHUB_TOKEN}",
            },
          },
        },
      }),
      "utf-8",
    );

    const out = await queryChutesStatus();
    expect(out).toBeNull();
  });

  it("handles zero status safely", async () => {
    process.env.CHUTES_API_KEY = "test-key";

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: 0,
              used: 0,
            }),
            { status: 200 },
          ),
      ) as any,
    );

    const out = await queryChutesStatus();
    expect(out && out.success ? out.percentRemaining : -1).toBe(0);
  });
});
