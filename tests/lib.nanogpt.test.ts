import { describe, expect, it, vi } from "vitest";

import { queryNanoGptStatus } from "../src/lib/nanogpt.js";

vi.mock("../src/lib/nanogpt-config.js", () => ({
  resolveNanoGptApiKey: vi.fn(),
  hasNanoGptApiKey: vi.fn(),
  getNanoGptKeyDiagnostics: vi.fn(),
}));

describe("queryNanoGptStatus", () => {
  it("returns null when not configured", async () => {
    const { resolveNanoGptApiKey } = await import("../src/lib/nanogpt-config.js");
    (resolveNanoGptApiKey as any).mockResolvedValueOnce(null);

    await expect(queryNanoGptStatus()).resolves.toBeNull();
  });

  it("returns usage and balance when both endpoints succeed", async () => {
    const { resolveNanoGptApiKey } = await import("../src/lib/nanogpt-config.js");
    (resolveNanoGptApiKey as any).mockResolvedValueOnce({
      key: "nano-key",
      source: "env:NANOGPT_API_KEY",
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/subscription/v1/usage")) {
        expect(init?.method).toBe("GET");
        expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("nano-key");
        return new Response(
          JSON.stringify({
            active: true,
            limits: { daily: 5000, monthly: 60000 },
            enforceDailyLimit: true,
            daily: {
              used: 50,
              remaining: 4950,
              percentUsed: 0.01,
              resetAt: 1_738_540_800_000,
            },
            monthly: {
              used: 1000,
              remaining: 59000,
              percentUsed: 0.0167,
              resetAt: 1_739_404_800_000,
            },
            period: {
              currentPeriodEnd: "2025-02-13T23:59:59.000Z",
            },
            state: "active",
            graceUntil: null,
          }),
          { status: 200 },
        );
      }

      expect(url).toContain("/check-balance");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("nano-key");
      return new Response(
        JSON.stringify({
          usd_balance: "129.46956147",
          nano_balance: "26.71801147",
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock as any);

    const out = await queryNanoGptStatus();
    expect(out).toEqual({
      success: true,
      subscription: {
        active: true,
        state: "active",
        enforceDailyLimit: true,
        daily: {
          used: 50,
          limit: 5000,
          remaining: 4950,
          percentRemaining: 99,
          resetTimeIso: "2025-02-03T00:00:00.000Z",
        },
        monthly: {
          used: 1000,
          limit: 60000,
          remaining: 59000,
          percentRemaining: 98,
          resetTimeIso: "2025-02-13T00:00:00.000Z",
        },
        currentPeriodEndIso: "2025-02-13T23:59:59.000Z",
        graceUntilIso: undefined,
      },
      balance: {
        usdBalance: 129.46956147,
        usdBalanceRaw: "129.46956147",
        nanoBalanceRaw: "26.71801147",
      },
      endpointErrors: undefined,
    });
  });

  it("returns partial success when usage succeeds and balance fails", async () => {
    const { resolveNanoGptApiKey } = await import("../src/lib/nanogpt-config.js");
    (resolveNanoGptApiKey as any).mockResolvedValueOnce({
      key: "nano-key",
      source: "env:NANOGPT_API_KEY",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/subscription/v1/usage")) {
          return new Response(
            JSON.stringify({
              active: false,
              limits: { daily: 100, monthly: 1000 },
              enforceDailyLimit: true,
              daily: {
                used: 100,
                remaining: 0,
                percentUsed: 1,
                resetAt: 1_735_776_000_000,
              },
              state: "grace",
              graceUntil: "2026-01-09T00:00:00.000Z",
            }),
            { status: 200 },
          );
        }
        return new Response("Unauthorized", { status: 401 });
      }) as any,
    );

    const out = await queryNanoGptStatus();
    expect(out).toEqual({
      success: true,
      subscription: {
        active: false,
        state: "grace",
        enforceDailyLimit: true,
        daily: {
          used: 100,
          limit: 100,
          remaining: 0,
          percentRemaining: 0,
          resetTimeIso: "2025-01-02T00:00:00.000Z",
        },
        monthly: undefined,
        currentPeriodEndIso: undefined,
        graceUntilIso: "2026-01-09T00:00:00.000Z",
      },
      balance: undefined,
      endpointErrors: [
        {
          endpoint: "balance",
          message: "NanoGPT API error 401: Unauthorized",
        },
      ],
    });
  });

  it("returns partial success when balance succeeds and usage fails", async () => {
    const { resolveNanoGptApiKey } = await import("../src/lib/nanogpt-config.js");
    (resolveNanoGptApiKey as any).mockResolvedValueOnce({
      key: "nano-key",
      source: "env:NANOGPT_API_KEY",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/subscription/v1/usage")) {
          return new Response("bad gateway", { status: 502 });
        }
        return new Response(
          JSON.stringify({
            usd_balance: "12.50",
            nano_balance: "3.25",
          }),
          { status: 200 },
        );
      }) as any,
    );

    const out = await queryNanoGptStatus();
    expect(out).toEqual({
      success: true,
      subscription: undefined,
      balance: {
        usdBalance: 12.5,
        usdBalanceRaw: "12.50",
        nanoBalanceRaw: "3.25",
      },
      endpointErrors: [
        {
          endpoint: "usage",
          message: "NanoGPT API error 502: bad gateway",
        },
      ],
    });
  });

  it("returns a combined error when both endpoints fail", async () => {
    const { resolveNanoGptApiKey } = await import("../src/lib/nanogpt-config.js");
    (resolveNanoGptApiKey as any).mockResolvedValueOnce({
      key: "nano-key",
      source: "env:NANOGPT_API_KEY",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return new Response(url.includes("/subscription/v1/usage") ? "usage failed" : "balance failed", {
          status: url.includes("/subscription/v1/usage") ? 500 : 403,
        });
      }) as any,
    );

    await expect(queryNanoGptStatus()).resolves.toEqual({
      success: false,
      error:
        "Usage: NanoGPT API error 500: usage failed; Balance: NanoGPT API error 403: balance failed",
    });
  });

  it("treats unexpected response shapes as endpoint errors", async () => {
    const { resolveNanoGptApiKey } = await import("../src/lib/nanogpt-config.js");
    (resolveNanoGptApiKey as any).mockResolvedValueOnce({
      key: "nano-key",
      source: "env:NANOGPT_API_KEY",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/subscription/v1/usage")) {
          return new Response(JSON.stringify({ nope: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ usd_balance: "5.00" }), { status: 200 });
      }) as any,
    );

    await expect(queryNanoGptStatus()).resolves.toEqual({
      success: true,
      subscription: undefined,
      balance: {
        usdBalance: 5,
        usdBalanceRaw: "5.00",
        nanoBalanceRaw: undefined,
      },
      endpointErrors: [
        {
          endpoint: "usage",
          message: "NanoGPT usage response returned an unexpected response shape",
        },
      ],
    });
  });

  it("returns caught errors when fetch fails", async () => {
    const { resolveNanoGptApiKey } = await import("../src/lib/nanogpt-config.js");
    (resolveNanoGptApiKey as any).mockResolvedValueOnce({
      key: "nano-key",
      source: "env:NANOGPT_API_KEY",
    });

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network down"))) as any);

    await expect(queryNanoGptStatus()).resolves.toEqual({
      success: false,
      error: "Usage: network down; Balance: network down",
    });
  });
});
