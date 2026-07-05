import { rm } from "fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMMAND_HANDLED_SENTINEL } from "../src/lib/command-handled.js";
import { DEFAULT_CONFIG } from "../src/lib/types.js";
import {
  createAlibabaAuthModuleMock,
  createConfigModuleMock,
  createPluginTestClient as createClient,
  createPluginToolMockModule,
  createPricingModuleMock,
  createProvidersRegistryModuleMock,
  createQwenAuthModuleMock,
  createSessionTokensModuleMock,
  getToastMessage,
  seedDefaultPluginBootstrapMocks,
} from "./helpers/plugin-test-harness.js";

const TEST_RUNTIME_ROOT = "/tmp/status-provider-plugin-status-provider-toast-command-tests";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  getProviders: vi.fn(),
  maybeRefreshPricingSnapshot: vi.fn(),
  getPricingSnapshotMeta: vi.fn(),
  getPricingSnapshotSource: vi.fn(),
  getRuntimePricingRefreshStatePath: vi.fn(),
  getRuntimePricingSnapshotPath: vi.fn(),
  setPricingSnapshotAutoRefresh: vi.fn(),
  setPricingSnapshotSelection: vi.fn(),
  resolveQwenLocalPlanCached: vi.fn(),
  resolveAlibabaCodingPlanAuthCached: vi.fn(),
  fetchSessionTokensForDisplay: vi.fn(),
}));

vi.mock("@opencode-ai/plugin", () => createPluginToolMockModule());

vi.mock("../src/lib/config.js", () => createConfigModuleMock(mocks.loadConfig));

vi.mock("../src/providers/registry.js", () =>
  createProvidersRegistryModuleMock(mocks.getProviders),
);

vi.mock("../src/lib/modelsdev-pricing.js", () => createPricingModuleMock(mocks));

vi.mock("../src/lib/session-tokens.js", () =>
  createSessionTokensModuleMock(mocks.fetchSessionTokensForDisplay),
);

vi.mock("../src/lib/qwen-auth.js", () =>
  createQwenAuthModuleMock(mocks.resolveQwenLocalPlanCached),
);

vi.mock("../src/lib/alibaba-auth.js", () =>
  createAlibabaAuthModuleMock(mocks.resolveAlibabaCodingPlanAuthCached),
);

vi.mock("../src/lib/opencode-runtime-paths.js", () => ({
  getOpencodeRuntimeDirs: () => ({
    dataDir: `${TEST_RUNTIME_ROOT}/data`,
    configDir: `${TEST_RUNTIME_ROOT}/config`,
    cacheDir: `${TEST_RUNTIME_ROOT}/cache`,
    stateDir: `${TEST_RUNTIME_ROOT}/state`,
  }),
}));

describe("/status-provider-toast command behavior", () => {
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    savedConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    seedDefaultPluginBootstrapMocks(mocks, {
      configOverrides: {
        enabled: true,
        showOnIdle: false,
        showOnCompact: false,
        showOnQuestion: false,
        showSessionTokens: false,
        minIntervalMs: 60_000,
      },
      resetPluginState: true,
    });
    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
    const { __resetStatusStateForTests } = await import("../src/lib/status-state.js");
    __resetStatusStateForTests();
    mocks.resolveQwenLocalPlanCached.mockResolvedValue({ state: "none" });
    mocks.resolveAlibabaCodingPlanAuthCached.mockResolvedValue({ state: "none" });
  });

  afterEach(async () => {
    if (savedConfigDir !== undefined) process.env.OPENCODE_CONFIG_DIR = savedConfigDir;
    else delete process.env.OPENCODE_CONFIG_DIR;
    const { __resetStatusStateForTests } = await import("../src/lib/status-state.js");
    __resetStatusStateForTests();
    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
  });

  it("registers /status-provider-toast in plugin config", async () => {
    mocks.loadConfig.mockResolvedValueOnce({ ...DEFAULT_CONFIG, enabled: true });

    const { StatusProviderPlugin } = await import("../src/plugin.js");
    const client = createClient();
    const hooks = await StatusProviderPlugin({ client } as any);

    const cfg: { command?: Record<string, { template: string; description: string }> } = {};
    await hooks.config?.(cfg);

    expect(cfg.command?.["status-provider-toast"]).toEqual({
      template: "/status-provider-toast",
      description: "Force-show the actual popup toast right now (bypasses cache/interval).",
    });
  });

  it("forces the popup toast immediately, bypassing cache/interval, without injecting chat text", async () => {
    mocks.loadConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      enabled: true,
      enabledProviders: ["openai"],
      showOnIdle: false,
      showOnCompact: false,
      showOnQuestion: false,
      showSessionTokens: false,
      minIntervalMs: 60_000,
    });

    const provider = {
      id: "openai",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ name: "OpenAI Pro", percentRemaining: 72 }],
        errors: [],
      }),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const { StatusProviderPlugin } = await import("../src/plugin.js");
    const client = createClient({ modelID: "openai/gpt-5", providerID: "openai" });
    const hooks = await StatusProviderPlugin({ client } as any);

    await expect(
      hooks["command.execute.before"]?.({
        command: "status-provider-toast",
        sessionID: "session-force-toast",
      } as any),
    ).rejects.toThrow(COMMAND_HANDLED_SENTINEL);

    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(client.tui.showToast).toHaveBeenCalledTimes(1);
    expect(getToastMessage(client, 0)).toContain("72% left");
    expect(client.session.prompt).not.toHaveBeenCalled();
  });

  it("calls the toast twice in a row without throttling, since it bypasses the interval cache", async () => {
    mocks.loadConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      enabled: true,
      enabledProviders: ["openai"],
      showOnIdle: false,
      showOnCompact: false,
      showOnQuestion: false,
      showSessionTokens: false,
      // A long interval would normally throttle a second toast within this window.
      minIntervalMs: 5 * 60_000,
    });

    const provider = {
      id: "openai",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ name: "OpenAI Pro", percentRemaining: 50 }],
        errors: [],
      }),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const { StatusProviderPlugin } = await import("../src/plugin.js");
    const client = createClient({ modelID: "openai/gpt-5", providerID: "openai" });
    const hooks = await StatusProviderPlugin({ client } as any);

    for (let i = 0; i < 2; i++) {
      await expect(
        hooks["command.execute.before"]?.({
          command: "status-provider-toast",
          sessionID: "session-force-toast-twice",
        } as any),
      ).rejects.toThrow(COMMAND_HANDLED_SENTINEL);
    }

    expect(provider.fetch).toHaveBeenCalledTimes(2);
    expect(client.tui.showToast).toHaveBeenCalledTimes(2);
  });
});
