import { describe, expect, it, vi } from "vitest";

import { queryZaiStatus } from "../src/lib/zai.js";

const mocks = vi.hoisted(() => ({
  resolveZaiAuthCached: vi.fn(),
}));

vi.mock("../src/lib/zai-auth.js", () => ({
  resolveZaiAuthCached: mocks.resolveZaiAuthCached,
}));

async function mockZaiAuth(key: string = "zai-test-key"): Promise<void> {
  mocks.resolveZaiAuthCached.mockResolvedValueOnce({
    state: "configured",
    apiKey: key,
  });
}

describe("queryZaiStatus", () => {
  it("returns null when not configured", async () => {
    mocks.resolveZaiAuthCached.mockResolvedValueOnce({ state: "none" });

    await expect(queryZaiStatus()).resolves.toBeNull();
  });

  it("returns auth errors when zai-coding-plan auth is invalid", async () => {
    mocks.resolveZaiAuthCached.mockResolvedValueOnce({
      state: "invalid",
      error: 'Unsupported Z.ai auth type: "oauth"',
    });
    await expect(queryZaiStatus()).resolves.toEqual({
      success: false,
      error: 'Unsupported Z.ai auth type: "oauth"',
    });
  });

  it("returns API status errors with truncated response body", async () => {
    await mockZaiAuth();
    const body = "x".repeat(200);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 500 })) as any,
    );

    const out = await queryZaiStatus();
    expect(out && !out.success ? out.error : "").toBe(
      `Z.ai API error 500: ${body.slice(0, 120)}`,
    );
  });

  it("returns invalid status data when limits is missing or not an array", async () => {
    await mockZaiAuth();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 0,
              msg: "ok",
              success: true,
              data: { level: "pro", limits: null },
            }),
            { status: 200 },
          ),
      ) as any,
    );

    const out = await queryZaiStatus();
    expect(out).toEqual({ success: false, error: "Invalid status data" });
  });

  it("maps unit windows and clamps percentages", async () => {
    const fiveHourResetMs = 1_735_776_000_000;
    const weeklyResetMs = 1_736_121_600_000;
    const mcpResetMs = 1_735_948_800_000;

    await mockZaiAuth();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 0,
              msg: "ok",
              success: true,
              data: {
                level: "pro",
                limits: [
                  {
                    type: "TOKENS_LIMIT",
                    unit: 3,
                    number: 100,
                    usage: 33.3,
                    percentage: 33.3,
                    nextResetTime: fiveHourResetMs,
                  },
                  {
                    type: "TOKENS_LIMIT",
                    unit: 6,
                    number: 100,
                    usage: 55.5,
                    percentage: 55.5,
                    nextResetTime: weeklyResetMs,
                  },
                  {
                    type: "TIME_LIMIT",
                    unit: 5,
                    number: 100,
                    usage: 10,
                    percentage: 10,
                    nextResetTime: mcpResetMs,
                  },
                ],
              },
            }),
            { status: 200 },
          ),
      ) as any,
    );

    const out = await queryZaiStatus();
    expect(out && out.success ? out.label : "").toBe("Z.ai");
    expect(out && out.success ? out.windows.fiveHour : undefined).toEqual({
      percentRemaining: 67,
      resetTimeIso: new Date(fiveHourResetMs).toISOString(),
    });
    expect(out && out.success ? out.windows.weekly : undefined).toEqual({
      percentRemaining: 45,
      resetTimeIso: new Date(weeklyResetMs).toISOString(),
    });
    expect(out && out.success ? out.windows.mcp : undefined).toEqual({
      percentRemaining: 90,
      resetTimeIso: new Date(mcpResetMs).toISOString(),
    });
  });

  it("prefers the weekly unit when both daily and weekly token windows are present", async () => {
    await mockZaiAuth();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 0,
              msg: "ok",
              success: true,
              data: {
                level: "pro",
                limits: [
                  {
                    type: "TOKENS_LIMIT",
                    unit: 4,
                    number: 100,
                    usage: 20,
                    percentage: 20,
                    nextResetTime: 1_735_862_400_000,
                  },
                  {
                    type: "TOKENS_LIMIT",
                    unit: 6,
                    number: 100,
                    usage: 70,
                    percentage: 70,
                    nextResetTime: 1_736_121_600_000,
                  },
                ],
              },
            }),
            { status: 200 },
          ),
      ) as any,
    );

    const out = await queryZaiStatus();
    expect(out && out.success ? out.windows.weekly : undefined).toEqual({
      percentRemaining: 30,
      resetTimeIso: "2025-01-06T00:00:00.000Z",
    });
  });

  it("still uses the weekly unit when it appears before the daily token window", async () => {
    await mockZaiAuth();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 0,
              msg: "ok",
              success: true,
              data: {
                level: "pro",
                limits: [
                  {
                    type: "TOKENS_LIMIT",
                    unit: 6,
                    number: 100,
                    usage: 70,
                    percentage: 70,
                    nextResetTime: 1_736_121_600_000,
                  },
                  {
                    type: "TOKENS_LIMIT",
                    unit: 4,
                    number: 100,
                    usage: 20,
                    percentage: 20,
                    nextResetTime: 1_735_862_400_000,
                  },
                ],
              },
            }),
            { status: 200 },
          ),
      ) as any,
    );

    const out = await queryZaiStatus();
    expect(out && out.success ? out.windows.weekly : undefined).toEqual({
      percentRemaining: 30,
      resetTimeIso: "2025-01-06T00:00:00.000Z",
    });
  });

  it("returns caught errors when fetch fails", async () => {
    await mockZaiAuth();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network down"))) as any);

    const out = await queryZaiStatus();
    expect(out).toEqual({ success: false, error: "network down" });
  });
});
