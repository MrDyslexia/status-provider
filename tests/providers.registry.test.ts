import { describe, expect, it } from "vitest";

import { getOrderedProviders, getProviders } from "../src/providers/registry.js";
import type { StatusProviderConfig } from "../src/lib/types.js";

function makeConfig(partial: Partial<StatusProviderConfig>): StatusProviderConfig {
  return {
    enabled: true,
    enableToast: true,
    formatStyle: "singleWindow",
    percentDisplayMode: "remaining",
    minIntervalMs: 300000,
    requestTimeoutMs: 5000,
    debug: false,
    enabledProviders: "auto",
    providerOrder: [],
    textVariant: "default",
    providerNameVariant: "full",
    percentVariant: "both",
    colorVariant: "none",
    alignmentVariant: "left",
    anthropicBinaryPath: "claude",
    googleModels: ["CLAUDE"],
    alibabaCodingPlanTier: "lite",
    cursorPlan: "none",
    opencodeGoWindows: ["rolling", "weekly", "monthly"],
    pricingSnapshot: { source: "auto", autoRefresh: 7 },
    showOnIdle: true,
    showOnQuestion: true,
    showOnCompact: true,
    showOnBothFail: true,
    toastDurationMs: 9000,
    onlyCurrentModel: false,
    showSessionTokens: true,
    tuiSidebarPanel: { enabled: true },
    tuiCompactStatus: { enabled: false, homeBottom: true, sessionPrompt: true, suppressWhenNativeProviderStatus: true, maxWidth: 96 },
    layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
    ...partial,
  };
}

describe("getOrderedProviders", () => {
  it("returns providers in default registry order when providerOrder is empty", () => {
    const config = makeConfig({});
    const ids = getOrderedProviders(config).map((p) => p.id);
    expect(ids).toEqual(getProviders().map((p) => p.id));
  });

  it("orders providers according to providerOrder", () => {
    const config = makeConfig({ providerOrder: ["openai", "copilot", "anthropic"] });
    const ids = getOrderedProviders(config).map((p) => p.id);
    expect(ids.slice(0, 3)).toEqual(["openai", "copilot", "anthropic"]);
  });

  it("normalizes provider aliases in providerOrder", () => {
    const config = makeConfig({ providerOrder: ["claude", "github-copilot", "OpenAI"] });
    const ids = getOrderedProviders(config).map((p) => p.id);
    expect(ids.slice(0, 3)).toEqual(["anthropic", "copilot", "openai"]);
  });

  it("limits auto-enabled providers to providerOrder when providerOrder is non-empty", () => {
    const config = makeConfig({ providerOrder: ["openai"] });
    const ids = getOrderedProviders(config).map((p) => p.id);
    expect(ids).toEqual(["openai"]);
  });

  it("appends unlisted providers after ordered ones when providerOrder is empty", () => {
    const config = makeConfig({ providerOrder: [] });
    const ids = getOrderedProviders(config).map((p) => p.id);
    expect(ids.length).toBe(getProviders().length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("filters to explicit enabledProviders while respecting providerOrder", () => {
    const config = makeConfig({
      enabledProviders: ["anthropic", "copilot", "openai"],
      providerOrder: ["openai", "copilot", "anthropic", "cursor"],
    });
    const ids = getOrderedProviders(config).map((p) => p.id);
    expect(ids).toEqual(["openai", "copilot", "anthropic"]);
  });

  it("ignores unknown provider ids", () => {
    const config = makeConfig({ providerOrder: ["openai", "unknown-provider", "copilot"] });
    const ids = getOrderedProviders(config).map((p) => p.id);
    expect(ids[0]).toBe("openai");
    expect(ids[1]).toBe("copilot");
    expect(ids).not.toContain("unknown-provider");
  });
});
