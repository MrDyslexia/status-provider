import { rm } from "fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const TEST_RUNTIME_ROOT = "/tmp/status-provider-plugin-toast-visual-variants-tests";

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

describe("toast honors toast-specific visual variants independently from sidebar/CLI ones", () => {
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    savedConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    seedDefaultPluginBootstrapMocks(mocks, {
      configOverrides: {
        enabled: true,
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

  it("renders the toast with the box text variant while the sidebar/CLI variant stays default", async () => {
    mocks.loadConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      enabled: true,
      enabledProviders: ["openai"],
      showOnIdle: true,
      showOnCompact: false,
      showOnQuestion: false,
      showSessionTokens: false,
      minIntervalMs: 60_000,
      // Sidebar/CLI stays on the default text variant.
      textVariant: "default",
      // Toast gets its own independent variant.
      toastTextVariant: "box",
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

    await hooks.event?.({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-toast-box-variant" },
      },
    } as any);

    expect(client.tui.showToast).toHaveBeenCalledTimes(1);
    const toastMessage = getToastMessage(client, 0);
    expect(toastMessage).toMatch(/^┌[─]+┐/);
  });

  it("keeps the toast on the default text variant when only the sidebar/CLI variant is set to box", async () => {
    mocks.loadConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      enabled: true,
      enabledProviders: ["openai"],
      showOnIdle: true,
      showOnCompact: false,
      showOnQuestion: false,
      showSessionTokens: false,
      minIntervalMs: 60_000,
      // Sidebar/CLI switches to the box variant...
      textVariant: "box",
      // ...but the toast keeps its own (default) variant.
      toastTextVariant: "default",
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

    await hooks.event?.({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-toast-default-variant" },
      },
    } as any);

    expect(client.tui.showToast).toHaveBeenCalledTimes(1);
    const toastMessage = getToastMessage(client, 0);
    expect(toastMessage).not.toMatch(/^┌[─]+┐/);
    expect(toastMessage).toContain("72% left");
  });
});
