import { describe, expect, it, vi } from "vitest";

const { mockProviders } = vi.hoisted(() => ({
  mockProviders: [] as any[],
}));

vi.mock("../src/providers/registry.js", () => ({
  getProviders: () => mockProviders,
}));

import { detectAvailableProviderIds } from "../src/lib/cli-config.js";
import type { StatusProviderConfig } from "../src/lib/types.js";

function createConfig(): StatusProviderConfig {
  return {
    googleModels: [],
    alibabaCodingPlanTier: "lite",
    cursorPlan: "none",
  } as any;
}

describe("detectAvailableProviderIds (config wizard auto-detect)", () => {
  it("only returns providers whose isAvailable() resolves true, not the full registry", async () => {
    mockProviders.length = 0;
    mockProviders.push(
      { id: "kimi-for-coding", isAvailable: vi.fn().mockResolvedValue(true) },
      { id: "openai", isAvailable: vi.fn().mockResolvedValue(true) },
      { id: "anthropic", isAvailable: vi.fn().mockResolvedValue(true) },
      { id: "cursor", isAvailable: vi.fn().mockResolvedValue(false) },
      { id: "copilot", isAvailable: vi.fn().mockResolvedValue(false) },
    );

    const client = {
      config: {
        providers: async () => ({ data: { providers: [] } }),
        get: async () => ({ data: {} }),
      },
    };

    const ids = await detectAvailableProviderIds({ client, config: createConfig() });

    expect(ids.sort()).toEqual(["anthropic", "kimi-for-coding", "openai"]);
  });

  it("treats a provider whose isAvailable() throws as not detected instead of crashing", async () => {
    mockProviders.length = 0;
    mockProviders.push(
      { id: "kimi-for-coding", isAvailable: vi.fn().mockResolvedValue(true) },
      {
        id: "broken-provider",
        isAvailable: vi.fn().mockRejectedValue(new Error("boom")),
      },
    );

    const client = {
      config: {
        providers: async () => ({ data: { providers: [] } }),
        get: async () => ({ data: {} }),
      },
    };

    const ids = await detectAvailableProviderIds({ client, config: createConfig() });

    expect(ids).toEqual(["kimi-for-coding"]);
  });

  it("returns an empty list (not every registered provider) when nothing is detected", async () => {
    mockProviders.length = 0;
    mockProviders.push(
      { id: "cursor", isAvailable: vi.fn().mockResolvedValue(false) },
      { id: "copilot", isAvailable: vi.fn().mockResolvedValue(false) },
    );

    const client = {
      config: {
        providers: async () => ({ data: { providers: [] } }),
        get: async () => ({ data: {} }),
      },
    };

    const ids = await detectAvailableProviderIds({ client, config: createConfig() });

    expect(ids).toEqual([]);
  });
});
