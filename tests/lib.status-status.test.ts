import { beforeEach, describe, expect, it, vi } from "vitest";

const fsPromiseMocks = vi.hoisted(() => ({
  stat: vi.fn(async () => {
    throw new Error("missing");
  }),
}));

const copilotMocks = vi.hoisted(() => ({
  getCopilotStatusAuthDiagnostics: vi.fn(() => ({
    pat: {
      state: "valid",
      checkedPaths: ["/tmp/copilot-status-token.json"],
      selectedPath: "/tmp/copilot-status-token.json",
      tokenKind: "github_pat",
      config: {
        token: "github_pat_123",
        tier: "business",
        organization: "acme-corp",
        username: "alice",
      },
    },
    oauth: {
      configured: true,
      keyName: "github-copilot",
      hasRefreshToken: false,
      hasAccessToken: true,
    },
    effectiveSource: "pat",
    override: "pat_overrides_oauth",
    billingMode: "organization_usage",
    billingScope: "organization",
    statusApi: "github_billing_api",
    billingApiAccessLikely: true,
    remainingTotalsState: "not_available_from_org_usage",
    queryPeriod: {
      year: 2026,
      month: 1,
    },
    usernameFilter: "alice",
  })),
}));

const pricingMocks = vi.hoisted(() => ({
  getPricingSnapshotSource: vi.fn(() => "bundled"),
}));

const googleMocks = vi.hoisted(() => ({
  inspectAntigravityAccountsPresence: vi.fn(async () => ({
    state: "missing" as const,
    presentPaths: [],
    candidatePaths: ["/tmp/antigravity-accounts.json"],
    accountCount: 0,
    validAccountCount: 0,
  })),
}));

const googleCompanionMocks = vi.hoisted(() => ({
  inspectAntigravityCompanionPresence: vi.fn(async () => ({
    state: "missing" as const,
    importSpecifier: "opencode-antigravity-auth/dist/src/constants.js",
    error: "Install opencode-antigravity-auth separately to enable Google Antigravity status",
  })),
}));

const geminiCliMocks = vi.hoisted(() => ({
  inspectGeminiCliAuthPresence: vi.fn(async () => ({
    state: "missing" as const,
    accountCount: 0,
    validAccountCount: 0,
  })),
  inspectGeminiCliCompanionPresence: vi.fn(async () => ({
    state: "missing" as const,
    importSpecifier: "opencode-gemini-auth/src/constants.ts",
    error: "Install opencode-gemini-auth separately to enable Gemini CLI status",
  })),
}));

const openaiMocks = vi.hoisted(() => ({
  resolveOpenAIOAuth: vi.fn(() => ({ state: "none" as const })),
}));

const alibabaMocks = vi.hoisted(() => ({
  getAlibabaCodingPlanAuthDiagnostics: vi.fn(async () => ({
    state: "none" as const,
    source: null,
    checkedPaths: [],
    authPaths: ["/tmp/auth.json"],
  })),
  resolveAlibabaCodingPlanAuthCached: vi.fn(async () => ({ state: "none" as const })),
}));

const minimaxMocks = vi.hoisted(() => ({
  getMiniMaxAuthDiagnostics: vi.fn(async () => ({
    state: "none" as const,
    source: null,
    checkedPaths: [],
    authPaths: ["/tmp/auth.json"],
  })),
  getMiniMaxChinaAuthDiagnostics: vi.fn(async () => ({
    state: "none" as const,
    source: null,
    checkedPaths: [],
    authPaths: ["/tmp/auth.json"],
  })),
  resolveMiniMaxAuthCached: vi.fn(async () => ({ state: "none" as const })),
  resolveMiniMaxChinaAuthCached: vi.fn(async () => ({ state: "none" as const })),
  queryMiniMaxStatus: vi.fn(async () => ({ success: true as const, entries: [] })),
}));

const zaiMocks = vi.hoisted(() => ({
  getZaiAuthDiagnostics: vi.fn(async () => ({
    state: "none" as const,
    source: null,
    checkedPaths: [],
    authPaths: ["/tmp/auth.json"],
  })),
  queryZaiStatus: vi.fn(async () => null),
}));

const zhipuMocks = vi.hoisted(() => ({
  getZhipuAuthDiagnostics: vi.fn(async () => ({
    state: "none" as const,
    source: null,
    checkedPaths: [],
    authPaths: ["/tmp/auth.json"],
  })),
  queryZhipuStatus: vi.fn(async () => null),
}));

const nanoGptMocks = vi.hoisted(() => ({
  getNanoGptKeyDiagnostics: vi.fn(async () => ({
    configured: false,
    source: null,
    checkedPaths: [],
    authPaths: ["/tmp/auth.json"],
  })),
  queryNanoGptStatus: vi.fn(async () => null),
}));

const syntheticMocks = vi.hoisted(() => ({
  getSyntheticKeyDiagnostics: vi.fn(async () => ({
    configured: false,
    source: null,
    checkedPaths: [],
  })),
  querySyntheticStatus: vi.fn(async () => null),
}));

const openCodeGoMocks = vi.hoisted(() => ({
  getOpenCodeGoConfigDiagnostics: vi.fn(async () => ({
    state: "none" as const,
    source: null,
    missing: null,
    error: null,
    checkedPaths: [],
  })),
  resolveOpenCodeGoConfigCached: vi.fn(async () => ({ state: "none" as const })),
  queryOpenCodeGoStatus: vi.fn(async () => null),
}));

const anthropicMocks = vi.hoisted(() => ({
  getAnthropicDiagnostics: vi.fn(async () => ({
    installed: true,
    version: "1.2.3",
    authStatus: "authenticated",
    statusSupported: false,
    statusSource: "none",
    checkedCommands: ["claude --version", "claude auth status --json"],
    message:
      "Claude CLI auth detected, but status was unavailable from both the local CLI and Claude OAuth fallback. Claude credentials file not found at /Users/test/.claude/.credentials.json.",
  })),
}));

vi.mock("fs/promises", () => ({
  stat: fsPromiseMocks.stat,
}));

vi.mock("../src/lib/opencode-auth.js", () => ({
  getAuthPath: () => "/tmp/auth.json",
  getAuthPaths: () => ["/tmp/auth.json"],
  readAuthFileCached: vi.fn(async () => ({})),
}));

vi.mock("../src/lib/opencode-runtime-paths.js", () => ({
  getOpencodeRuntimeDirs: () => ({
    dataDir: "/tmp/data",
    configDir: "/tmp/config",
    cacheDir: "/tmp/cache",
    stateDir: "/tmp/state",
  }),
  getOpencodeRuntimeDirCandidates: () => ({
    configDirs: ["/tmp/config"],
  }),
}));

vi.mock("../src/lib/opencode-go-config.js", () => ({
  getOpenCodeGoConfigDiagnostics: openCodeGoMocks.getOpenCodeGoConfigDiagnostics,
  resolveOpenCodeGoConfigCached: openCodeGoMocks.resolveOpenCodeGoConfigCached,
  DEFAULT_OPENCODE_GO_CONFIG_CACHE_MAX_AGE_MS: 30_000,
}));

vi.mock("../src/lib/opencode-go.js", () => ({
  queryOpenCodeGoStatus: openCodeGoMocks.queryOpenCodeGoStatus,
}));

vi.mock("../src/lib/google-token-cache.js", () => ({
  getGoogleTokenCachePath: () => "/tmp/google-token-cache.json",
}));

vi.mock("../src/lib/google.js", () => ({
  inspectAntigravityAccountsPresence: googleMocks.inspectAntigravityAccountsPresence,
}));

vi.mock("../src/lib/google-antigravity-companion.js", () => ({
  inspectAntigravityCompanionPresence: googleCompanionMocks.inspectAntigravityCompanionPresence,
}));

vi.mock("../src/lib/google-gemini-cli.js", () => ({
  inspectGeminiCliAuthPresence: geminiCliMocks.inspectGeminiCliAuthPresence,
}));

vi.mock("../src/lib/google-gemini-cli-companion.js", () => ({
  inspectGeminiCliCompanionPresence: geminiCliMocks.inspectGeminiCliCompanionPresence,
}));

vi.mock("../src/lib/anthropic.js", () => ({
  getAnthropicDiagnostics: anthropicMocks.getAnthropicDiagnostics,
}));

vi.mock("../src/lib/synthetic.js", () => ({
  getSyntheticKeyDiagnostics: syntheticMocks.getSyntheticKeyDiagnostics,
  querySyntheticStatus: syntheticMocks.querySyntheticStatus,
}));

vi.mock("../src/lib/chutes.js", () => ({
  getChutesKeyDiagnostics: vi.fn(async () => ({
    configured: false,
    source: null,
    checkedPaths: [],
  })),
}));

vi.mock("../src/lib/crof.js", () => ({
  getCrofKeyDiagnostics: vi.fn(async () => ({
    configured: false,
    source: null,
    checkedPaths: [],
  })),
}));

vi.mock("../src/lib/nanogpt.js", () => ({
  getNanoGptKeyDiagnostics: nanoGptMocks.getNanoGptKeyDiagnostics,
  queryNanoGptStatus: nanoGptMocks.queryNanoGptStatus,
}));

vi.mock("../src/lib/copilot.js", () => ({
  getCopilotStatusAuthDiagnostics: copilotMocks.getCopilotStatusAuthDiagnostics,
}));

vi.mock("../src/lib/qwen-local-status.js", () => ({
  computeQwenStatus: () => ({
    day: { used: 0, limit: 1000 },
    rpm: { used: 0, limit: 60 },
  }),
  computeAlibabaCodingPlanStatus: () => ({
    tier: "lite",
    fiveHour: { used: 0, limit: 1200 },
    weekly: { used: 0, limit: 9000 },
    monthly: { used: 0, limit: 18000 },
  }),
  getQwenLocalStatusPath: () => "/tmp/qwen-state.json",
  getAlibabaCodingPlanStatusPath: () => "/tmp/alibaba-state.json",
  readQwenLocalStatusState: vi.fn(async () => ({})),
  readAlibabaCodingPlanStatusState: vi.fn(async () => ({})),
}));

vi.mock("../src/lib/qwen-auth.js", () => ({
  hasQwenOAuthAuth: () => false,
  resolveQwenLocalPlan: () => ({ state: "none" }),
}));

vi.mock("../src/lib/openai.js", () => ({
  resolveOpenAIOAuth: openaiMocks.resolveOpenAIOAuth,
}));

vi.mock("../src/lib/alibaba-auth.js", () => ({
  DEFAULT_ALIBABA_AUTH_CACHE_MAX_AGE_MS: 5_000,
  getAlibabaCodingPlanAuthDiagnostics: alibabaMocks.getAlibabaCodingPlanAuthDiagnostics,
  resolveAlibabaCodingPlanAuthCached: alibabaMocks.resolveAlibabaCodingPlanAuthCached,
}));

vi.mock("../src/lib/minimax-auth.js", () => ({
  DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS: 5_000,
  getMiniMaxAuthDiagnostics: minimaxMocks.getMiniMaxAuthDiagnostics,
  getMiniMaxChinaAuthDiagnostics: minimaxMocks.getMiniMaxChinaAuthDiagnostics,
  resolveMiniMaxAuthCached: minimaxMocks.resolveMiniMaxAuthCached,
  resolveMiniMaxChinaAuthCached: minimaxMocks.resolveMiniMaxChinaAuthCached,
}));

vi.mock("../src/providers/minimax-coding-plan.js", () => ({
  queryMiniMaxStatus: minimaxMocks.queryMiniMaxStatus,
}));

vi.mock("../src/lib/zai-auth.js", () => ({
  DEFAULT_ZAI_AUTH_CACHE_MAX_AGE_MS: 5_000,
  getZaiAuthDiagnostics: zaiMocks.getZaiAuthDiagnostics,
}));

vi.mock("../src/lib/zai.js", () => ({
  queryZaiStatus: zaiMocks.queryZaiStatus,
}));

vi.mock("../src/lib/zhipu-auth.js", () => ({
  DEFAULT_ZHIPU_AUTH_CACHE_MAX_AGE_MS: 5_000,
  getZhipuAuthDiagnostics: zhipuMocks.getZhipuAuthDiagnostics,
}));

vi.mock("../src/lib/zhipu.js", () => ({
  queryZhipuStatus: zhipuMocks.queryZhipuStatus,
}));

vi.mock("../src/lib/cursor-detection.js", () => ({
  CURSOR_CANONICAL_PLUGIN_PACKAGE: "@playwo/opencode-cursor-oauth",
  inspectCursorAuthPresence: vi.fn(async () => ({
    state: "present",
    selectedPath: "/tmp/auth.json",
    presentPaths: ["/tmp/auth.json"],
    candidatePaths: ["/tmp/auth.json"],
  })),
  inspectCursorOpenCodeIntegration: vi.fn(async () => ({
    pluginEnabled: true,
    providerConfigured: true,
    matchedPaths: ["/tmp/opencode.json"],
    checkedPaths: ["/tmp/opencode.json"],
  })),
}));

vi.mock("../src/lib/cursor-usage.js", () => ({
  getCurrentCursorUsageSummary: vi.fn(async () => ({
    window: {
      source: "calendar_month",
      resetTimeIso: "2026-04-01T00:00:00.000Z",
    },
    api: {
      costUsd: 3.5,
      tokens: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 },
      messageCount: 2,
    },
    autoComposer: {
      costUsd: 1.25,
      tokens: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 },
      messageCount: 1,
    },
    total: {
      costUsd: 4.75,
      tokens: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 },
      messageCount: 3,
    },
    unknownModels: [],
  })),
}));

vi.mock("../src/lib/modelsdev-pricing.js", () => ({
  getPricingSnapshotHealth: () => ({
    ageMs: 0,
    maxAgeMs: 3600000,
    stale: false,
  }),
  getPricingRefreshPolicy: () => ({
    maxAgeMs: 3600000,
  }),
  getPricingSnapshotMeta: () => ({
    source: "test",
    generatedAt: Date.UTC(2026, 0, 1),
    units: "usd_per_1m_tokens",
  }),
  getPricingSnapshotSource: pricingMocks.getPricingSnapshotSource,
  getRuntimePricingRefreshStatePath: () => "/tmp/pricing-refresh-state.json",
  getRuntimePricingSnapshotPath: () => "/tmp/pricing-snapshot.json",
  listProviders: () => ["openai"],
  getProviderModelCount: () => 1,
  hasProvider: () => true,
  readPricingRefreshState: vi.fn(async () => null),
}));

vi.mock("../src/providers/registry.js", () => ({
  getProviders: () => [
    { id: "copilot" },
    { id: "cursor" },
    { id: "synthetic" },
    { id: "crof" },
    { id: "nanogpt" },
    { id: "kimi-for-coding" },
    { id: "kimi-code" },
  ],
}));

vi.mock("../src/lib/version.js", () => ({
  getPackageVersion: vi.fn(async () => "1.2.3"),
}));

vi.mock("../src/lib/opencode-storage.js", () => ({
  getOpenCodeDbPath: () => "/tmp/opencode.db",
  getOpenCodeDbPathCandidates: () => ["/tmp/opencode.db"],
  getOpenCodeDbStats: vi.fn(async () => ({
    sessionCount: 0,
    messageCount: 0,
    assistantMessageCount: 0,
  })),
}));

vi.mock("../src/lib/status-stats.js", () => ({
  aggregateUsage: vi.fn(async () => ({
    byModel: [],
    unknown: [],
    unpriced: [],
    bySourceProvider: [],
    totals: {
      unpriced: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 },
      unknown: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 },
    },
  })),
}));

describe("buildStatusStatusReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders config validation errors in the toast diagnostics section", async () => {
    const { buildStatusStatusReport } = await import("../src/lib/status-status.js");
    const geminiCliClient = { config: { get: vi.fn() } };

    const report = await buildStatusStatusReport({
      configSource: "files",
      configPaths: [
        "/tmp/project/status-provider/config.json (status-provider/config.json)",
      ],
      settingSources: {
        enabledProviders:
          "/tmp/project/status-provider/config.json (status-provider/config.json)",
      },
      configIssues: [
        {
          path: "/tmp/project/status-provider/config.json (status-provider/config.json)",
          key: "enabledProviders",
          message: "unknown provider id(s): opnai",
        },
      ],
      enabledProviders: [],
      alibabaCodingPlanTier: "lite",
      cursorPlan: "none",
      pricingSnapshotSource: "auto",
      onlyCurrentModel: false,
      providerAvailability: [],
      geminiCliClient,
    });

    expect(report).toContain("- enabledProviders: (none)");
    expect(report).toContain("- config_errors:");
    expect(report).toContain(
      "  - /tmp/project/status-provider/config.json (status-provider/config.json) enabledProviders: unknown provider id(s): opnai",
    );
    expect(geminiCliMocks.inspectGeminiCliAuthPresence).toHaveBeenCalledWith(geminiCliClient);
  });

  async function buildMiniMaxStatusReport(overrides: Record<string, unknown> = {}) {
    const { buildStatusStatusReport } = await import("../src/lib/status-status.js");

    return buildStatusStatusReport({
      configSource: "test",
      configPaths: [],
      enabledProviders: ["minimax-coding-plan", "minimax-china-coding-plan"],
      alibabaCodingPlanTier: "lite",
      cursorPlan: "none",
      pricingSnapshotSource: "auto",
      onlyCurrentModel: false,
      providerAvailability: [
        {
          id: "minimax-coding-plan",
          enabled: true,
          available: true,
        },
        {
          id: "minimax-china-coding-plan",
          enabled: true,
          available: true,
        },
      ],
      generatedAtMs: Date.UTC(2026, 2, 12, 12, 45, 0),
      ...overrides,
    } as any);
  }

  async function buildZaiStatusReport(overrides: Record<string, unknown> = {}) {
    const { buildStatusStatusReport } = await import("../src/lib/status-status.js");

    return buildStatusStatusReport({
      configSource: "test",
      configPaths: [],
      enabledProviders: ["zai"],
      alibabaCodingPlanTier: "lite",
      cursorPlan: "none",
      pricingSnapshotSource: "auto",
      onlyCurrentModel: false,
      providerAvailability: [
        {
          id: "zai",
          enabled: true,
          available: true,
        },
      ],
      generatedAtMs: Date.UTC(2026, 2, 12, 12, 45, 0),
      ...overrides,
    } as any);
  }

  async function buildZhipuStatusReport(overrides: Record<string, unknown> = {}) {
    const { buildStatusStatusReport } = await import("../src/lib/status-status.js");

    return buildStatusStatusReport({
      configSource: "test",
      configPaths: [],
      enabledProviders: ["zhipu"],
      alibabaCodingPlanTier: "lite",
      cursorPlan: "none",
      pricingSnapshotSource: "auto",
      onlyCurrentModel: false,
      providerAvailability: [
        {
          id: "zhipu",
          enabled: true,
          available: true,
        },
      ],
      generatedAtMs: Date.UTC(2026, 2, 12, 12, 45, 0),
      ...overrides,
    } as any);
  }

  async function buildOpenCodeGoStatusReport(overrides: Record<string, unknown> = {}) {
    const { buildStatusStatusReport } = await import("../src/lib/status-status.js");

    return buildStatusStatusReport({
      configSource: "test",
      configPaths: [],
      enabledProviders: ["opencode-go"],
      alibabaCodingPlanTier: "lite",
      cursorPlan: "none",
      pricingSnapshotSource: "auto",
      onlyCurrentModel: false,
      providerAvailability: [
        {
          id: "opencode-go",
          enabled: true,
          available: false,
        },
      ],
      generatedAtMs: Date.UTC(2026, 2, 12, 12, 45, 0),
      ...overrides,
    } as any);
  }

  async function buildSyntheticStatusReport(overrides: Record<string, unknown> = {}) {
    const { buildStatusStatusReport } = await import("../src/lib/status-status.js");

    return buildStatusStatusReport({
      configSource: "test",
      configPaths: [],
      enabledProviders: ["synthetic"],
      alibabaCodingPlanTier: "lite",
      cursorPlan: "none",
      pricingSnapshotSource: "auto",
      onlyCurrentModel: false,
      providerAvailability: [
        {
          id: "synthetic",
          enabled: true,
          available: true,
        },
      ],
      generatedAtMs: Date.UTC(2026, 2, 12, 12, 45, 0),
      ...overrides,
    } as any);
  }

  function getSection(report: string, title: string): string {
    const start = report.indexOf(`${title}\n`);
    expect(start).toBeGreaterThanOrEqual(0);

    const rest = report.slice(start + title.length + 1);
    const nextSectionOffset = rest.search(/\n[a-z0-9_]+:\n/u);
    if (nextSectionOffset === -1) {
      return report.slice(start);
    }

    return report.slice(start, start + title.length + 1 + nextSectionOffset);
  }

  it("distinguishes organization billing access from computable remaining status totals", async () => {
    const { buildStatusStatusReport } = await import("../src/lib/status-status.js");

    const report = await buildStatusStatusReport({
      configSource: "files",
      configPaths: [
        "/tmp/config/status-provider/config.json (status-provider/config.json)",
        "/tmp/project/status-provider/config.json (status-provider/config.json)",
      ],
      globalConfigPaths: ["/tmp/config/status-provider/config.json (status-provider/config.json)"],
      workspaceConfigPaths: ["/tmp/project/status-provider/config.json (status-provider/config.json)"],
      settingSources: {
        enabled: "/tmp/config/status-provider/config.json (status-provider/config.json)",
        enableToast: "/tmp/config/status-provider/config.json (status-provider/config.json)",
        minIntervalMs: "/tmp/project/status-provider/config.json (status-provider/config.json)",
        enabledProviders: "/tmp/project/status-provider/config.json (status-provider/config.json)",
        "pricingSnapshot.source": "/tmp/config/status-provider/config.json (status-provider/config.json)",
        "pricingSnapshot.autoRefresh": "/tmp/project/status-provider/config.json (status-provider/config.json)",
        showOnIdle: "/tmp/config/status-provider/config.json (status-provider/config.json)",
        showOnQuestion: "/tmp/project/status-provider/config.json (status-provider/config.json)",
        showOnCompact: "/tmp/project/status-provider/config.json (status-provider/config.json)",
        showOnBothFail: "/tmp/config/status-provider/config.json (status-provider/config.json)",
        "layout.maxWidth": "/tmp/project/status-provider/config.json (status-provider/config.json)",
      },
      tuiDiagnostics: {
        workspaceRoot: "/tmp/workspace",
        configRoot: "/tmp/project",
        configured: true,
        inferredSelectedPath: "/tmp/project/tui.jsonc",
        presentPaths: ["/tmp/config/tui.json", "/tmp/project/tui.jsonc"],
        candidatePaths: ["/tmp/config/tui.json", "/tmp/config/tui.jsonc", "/tmp/project/tui.json", "/tmp/project/tui.jsonc"],
        statusPluginConfigured: true,
        statusPluginConfigPaths: ["/tmp/project/tui.jsonc"],
      },
      enabledProviders: ["copilot"],
      anthropicBinaryPath: "/opt/claude/bin/claude",
      alibabaCodingPlanTier: "lite",
      cursorPlan: "pro",
      pricingSnapshotSource: "runtime",
      onlyCurrentModel: false,
      providerAvailability: [
        {
          id: "copilot",
          enabled: true,
          available: true,
        },
      ],
      generatedAtMs: Date.UTC(2026, 2, 12, 12, 45, 0),
    });

    expect(report).toMatch(
      /^# Status Provider Info \(status-provider v1\.2\.3\) \(\/status-provider-info\) \d{2}:\d{2} \d{2}\/\d{2}\/\d{4}\n\n/,
    );
    expect(report).toContain(
      "- opencode_dirs: data=/tmp/data config=/tmp/config cache=/tmp/cache state=/tmp/state",
    );
    expect(report).toContain(
      "- configPaths: /tmp/config/status-provider/config.json (status-provider/config.json) | /tmp/project/status-provider/config.json (status-provider/config.json)",
    );
    expect(report).toContain("- precedence: global defaults -> workspace overrides");
    expect(report).toContain(
      "- global_config_paths: /tmp/config/status-provider/config.json (status-provider/config.json)",
    );
    expect(report).toContain(
      "- workspace_config_paths: /tmp/project/status-provider/config.json (status-provider/config.json)",
    );
    expect(report).toContain(
      "- setting_sources: enabled<=/tmp/config/status-provider/config.json (status-provider/config.json) | enableToast<=/tmp/config/status-provider/config.json (status-provider/config.json) | minIntervalMs<=/tmp/project/status-provider/config.json (status-provider/config.json) | enabledProviders<=/tmp/project/status-provider/config.json (status-provider/config.json) | pricingSnapshot.source<=/tmp/config/status-provider/config.json (status-provider/config.json) | pricingSnapshot.autoRefresh<=/tmp/project/status-provider/config.json (status-provider/config.json) | showOnIdle<=/tmp/config/status-provider/config.json (status-provider/config.json) | showOnQuestion<=/tmp/project/status-provider/config.json (status-provider/config.json) | showOnCompact<=/tmp/project/status-provider/config.json (status-provider/config.json) | showOnBothFail<=/tmp/config/status-provider/config.json (status-provider/config.json) | layout.maxWidth<=/tmp/project/status-provider/config.json (status-provider/config.json)",
    );
    expect(report).toContain("tui:");
    expect(report).toContain("- workspace_root: /tmp/workspace");
    expect(report).toContain("- config_root: /tmp/project");
    expect(report).toContain("- config_configured: true");
    expect(report).toContain("- inferred_selected_config_path: /tmp/project/tui.jsonc");
    expect(report).toContain("- present_config_paths: /tmp/config/tui.json | /tmp/project/tui.jsonc");
    expect(report).toContain(
      "- candidate_config_paths: /tmp/config/tui.json | /tmp/config/tui.jsonc | /tmp/project/tui.json | /tmp/project/tui.jsonc",
    );
    expect(report).toContain("- status_plugin_configured: true");
    expect(report).toContain("- status_plugin_paths: /tmp/project/tui.jsonc");
    expect(report).toContain(
      "- auth.json: preferred=/tmp/auth.json present=(none) candidates=/tmp/auth.json",
    );
    expect(report).toContain(
      "- pricing: source=test active_source=bundled generated_at=2026-01-01T00:00:00.000Z units=usd_per_1m_tokens",
    );
    expect(report).toContain("- selection: configured=runtime active=bundled");
    expect(report).toContain(
      "- selection_note: runtime config requested the local runtime snapshot, but bundled fallback is active because no valid runtime snapshot is available",
    );
    expect(report).not.toContain("- opencode data:");
    expect(report).toContain("openai:");
    expect(report).toContain("- auth_configured: false");
    expect(report).toContain("- auth_source: (none)");
    expect(report).toContain("- token_status: (none)");
    expect(report).toContain("- token_expires_at: (none)");
    expect(report).toContain("- account_email: (none)");
    expect(report).toContain("- account_id: (none)");
    expect(report).toContain("- qwen_oauth_source: (none)");
    expect(report).toContain("- qwen_local_plan: (none)");
    expect(report).toContain("- alibaba auth configured: false");
    expect(report).toContain("- alibaba_api_key_source: (none)");
    expect(report).toContain("- alibaba_api_key_checked_paths: (none)");
    expect(report).toContain("- alibaba_api_key_auth_paths: /tmp/auth.json");
    expect(report).toContain("- alibaba coding plan fallback tier: lite");
    expect(report).toContain("- alibaba_coding_plan: (none)");
    expect(report).toContain("anthropic:");
    expect(report).toContain("- cli_installed: true");
    expect(report).toContain("- cli_version: 1.2.3");
    expect(report).toContain("- auth_status: authenticated");
    expect(report).toContain("- status_supported: false");
    expect(report).toContain("- status_source: (none)");
    expect(report).toContain("- checked_commands: claude --version | claude auth status --json");
    expect(report).toContain(
      "- message: Claude CLI auth detected, but status was unavailable from both the local CLI and Claude OAuth fallback. Claude credentials file not found at /Users/test/.claude/.credentials.json.",
    );
    expect(anthropicMocks.getAnthropicDiagnostics).toHaveBeenCalledWith({
      binaryPath: "/opt/claude/bin/claude",
    });
    expect(report).toContain("nanogpt:");
    expect(report).toContain("- api_key_configured: false");
    expect(report).toContain("- api_key_source: (none)");
    expect(report).toContain("- api_key_checked_paths: (none)");
    expect(report).toContain("- api_key_auth_paths: /tmp/auth.json");
    expect(report).toContain("zai:");
    expect(report).toContain("- auth_state: none");
    expect(report).toContain("- api_key_source: (none)");
    expect(report).toContain("- api_key_checked_paths: (none)");
    expect(report).toContain("- api_key_auth_paths: /tmp/auth.json");
    expect(report).toContain("synthetic:");
    expect(report).toContain("chutes:");
    expect(report).toContain("crof:");
    expect(report).toContain("- crof api key: configured=false");
    expect(report).toContain("cursor:");
    expect(report).toContain("- plan: Pro");
    expect(report).toContain("- included_api_usd: $20.00");
    expect(report).toContain("- auth_state: present");
    expect(report).toContain("- plugin_enabled: true");
    expect(report).toContain("- canonical_plugin_package: @playwo/opencode-cursor-oauth");
    expect(report).toContain("- provider_configured: true");
    expect(report).toContain("- cycle_source: calendar_month");
    expect(report).toContain("- api_usage: $3.50 across 2 messages");
    expect(report).toContain("- total_cursor_usage: $4.75 across 3 messages");
    expect(report).toContain("copilot_status_auth:");
    expect(report).toContain("- billing_mode: organization_usage");
    expect(report).toContain("- billing_scope: organization");
    expect(report).toContain("- status_api: github_billing_api");
    expect(report).toContain("- billing_api_access_likely: true");
    expect(report).toContain("- remaining_totals_state: not_available_from_org_usage");
    expect(report).toContain("- billing_period: 2026-01");
    expect(report).toContain("- username_filter: alice");
    expect(report).toContain("google_antigravity:");
    expect(report).toContain("- auth_state: missing");
    expect(report).toContain("- selected_accounts_path: (none)");
    expect(report).toContain("- present_accounts_paths: (none)");
    expect(report).toContain("- candidate_accounts_paths: /tmp/antigravity-accounts.json");
    expect(report).toContain("- account_count: 0");
    expect(report).toContain("- valid_account_count: 0");
    expect(report).toContain("- companion_package_state: missing");
    expect(report).toContain("- companion_package_path: (none)");
    expect(report).toContain(
      "- companion_error: Install opencode-antigravity-auth separately to enable Google Antigravity status",
    );
    expect(report).toContain("- token_cache_path: /tmp/google-token-cache.json exists=false");
    expect(report).toContain(
      "- billing_usage_note: organization premium usage for the current billing period",
    );
    expect(report).toContain(
      "- remaining_status_note: valid PAT access can query billing usage, but pooled org usage does not provide a true per-user remaining status",
    );
    expect(report).toContain(
      "- synthetic: pricing=no (subscription request status (not token-priced))",
    );
    expect(report).toContain(
      "- nanogpt: pricing=no (subscription request status + account balance (not token-priced))",
    );
    expect(report).toContain(
      "- crof: pricing=no (request status + credits (not token-priced))",
    );
    expect(report).toContain(
      "- kimi-for-coding: pricing=no (request status via Kimi Code API (not token-priced))",
    );
    expect(report).toContain(
      "- kimi-code: pricing=no (request status via Kimi Code API (not token-priced))",
    );
  });

  it("reports Anthropic status window details when the local Claude CLI exposes them", async () => {
    anthropicMocks.getAnthropicDiagnostics.mockResolvedValueOnce({
      installed: true,
      version: "1.2.4",
      authStatus: "authenticated",
      statusSupported: true,
      statusSource: "claude-auth-status-json",
      checkedCommands: ["claude --version", "claude auth status --json"],
      status: {
        success: true,
        five_hour: {
          percentRemaining: 43,
          resetTimeIso: "2026-03-25T18:00:00.000Z",
        },
        seven_day: {
          percentRemaining: 88,
          resetTimeIso: "2026-04-01T00:00:00.000Z",
        },
      },
    });

    const { buildStatusStatusReport } = await import("../src/lib/status-status.js");
    const report = await buildStatusStatusReport({
      configSource: "test",
      configPaths: [],
      enabledProviders: ["anthropic"],
      alibabaCodingPlanTier: "lite",
      cursorPlan: "none",
      pricingSnapshotSource: "auto",
      onlyCurrentModel: false,
      providerAvailability: [
        {
          id: "anthropic",
          enabled: true,
          available: true,
        },
      ],
      generatedAtMs: Date.UTC(2026, 2, 12, 12, 45, 0),
    });

    expect(report).toContain("- cli_version: 1.2.4");
    expect(report).toContain("- status_supported: true");
    expect(report).toContain("- status_source: claude-auth-status-json");
    expect(report).toContain("- five_hour_remaining: 43% reset_at=2026-03-25T18:00:00.000Z");
    expect(report).toContain("- seven_day_remaining: 88% reset_at=2026-04-01T00:00:00.000Z");
  });

  it("reports Anthropic status window details when the Claude OAuth fallback wins", async () => {
    anthropicMocks.getAnthropicDiagnostics.mockResolvedValueOnce({
      installed: true,
      version: "1.2.5",
      authStatus: "authenticated",
      statusSupported: true,
      statusSource: "claude-credentials-oauth-api",
      checkedCommands: ["claude --version", "claude auth status --json"],
      status: {
        success: true,
        five_hour: {
          percentRemaining: 65,
          resetTimeIso: "2026-03-25T18:00:00.000Z",
        },
        seven_day: {
          percentRemaining: 85,
          resetTimeIso: "2026-04-01T00:00:00.000Z",
        },
      },
    });

    const { buildStatusStatusReport } = await import("../src/lib/status-status.js");
    const report = await buildStatusStatusReport({
      configSource: "test",
      configPaths: [],
      enabledProviders: ["anthropic"],
      alibabaCodingPlanTier: "lite",
      cursorPlan: "none",
      pricingSnapshotSource: "auto",
      onlyCurrentModel: false,
      providerAvailability: [
        {
          id: "anthropic",
          enabled: true,
          available: true,
        },
      ],
      generatedAtMs: Date.UTC(2026, 2, 12, 12, 45, 0),
    });

    expect(report).toContain("- cli_version: 1.2.5");
    expect(report).toContain("- status_supported: true");
    expect(report).toContain("- status_source: claude-credentials-oauth-api");
    expect(report).toContain("- five_hour_remaining: 65% reset_at=2026-03-25T18:00:00.000Z");
    expect(report).toContain("- seven_day_remaining: 85% reset_at=2026-04-01T00:00:00.000Z");
  });

  it("renders Synthetic API-key diagnostics plus compact live success rows", async () => {
    syntheticMocks.getSyntheticKeyDiagnostics.mockResolvedValueOnce({
      configured: true,
      source: "env:SYNTHETIC_API_KEY",
      checkedPaths: ["env:SYNTHETIC_API_KEY"],
    });

    const report = await buildSyntheticStatusReport({
      providerLiveProbes: [
        {
          providerId: "synthetic",
          result: {
            attempted: true,
            entries: [
              {
                name: "Synthetic 5h",
                group: "Synthetic",
                label: "5h:",
                percentRemaining: 84.4,
                right: "9/50",
                resetTimeIso: "2026-04-21T18:00:00.000Z",
              },
              {
                name: "Synthetic Weekly",
                group: "Synthetic",
                label: "Weekly:",
                percentRemaining: 8.4552365,
                right: "$22/$24",
                resetTimeIso: "2026-04-27T18:00:00.000Z",
              },
            ],
            errors: [],
          },
        },
      ],
    });

    expect(report).toContain("synthetic:");
    expect(report).toContain("- synthetic api key: configured=true source=env:SYNTHETIC_API_KEY");
    expect(report).toContain("- live_probe: success");
    expect(report).toContain(
      "- live_entry_1: 5h: 9/50 percent_remaining=84 reset_at=2026-04-21T18:00:00.000Z",
    );
    expect(report).toContain(
      "- live_entry_2: Weekly: $22/$24 percent_remaining=8 reset_at=2026-04-27T18:00:00.000Z",
    );
    expect(syntheticMocks.querySyntheticStatus).not.toHaveBeenCalled();
  });

  it("renders Synthetic live no-data state when the shared probe returns nothing reportable", async () => {
    syntheticMocks.getSyntheticKeyDiagnostics.mockResolvedValueOnce({
      configured: true,
      source: "env:SYNTHETIC_API_KEY",
      checkedPaths: ["env:SYNTHETIC_API_KEY"],
    });

    const report = await buildSyntheticStatusReport({
      providerLiveProbes: [
        {
          providerId: "synthetic",
          result: {
            attempted: false,
            entries: [],
            errors: [],
          },
        },
      ],
    });

    expect(report).toContain("synthetic:");
    expect(report).toContain("- synthetic api key: configured=true source=env:SYNTHETIC_API_KEY");
    expect(report).toContain("- live_probe: no_data");
  });

  it("renders compact live probes in mapped and probe-only provider sections", async () => {
    const { buildStatusStatusReport } = await import("../src/lib/status-status.js");

    const report = await buildStatusStatusReport({
      configSource: "test",
      configPaths: [],
      enabledProviders: [
        "openai",
        "qwen-code",
        "alibaba-coding-plan",
        "minimax-coding-plan",
        "copilot",
        "google-antigravity",
        "google-gemini-cli",
        "chutes",
      ],
      alibabaCodingPlanTier: "lite",
      cursorPlan: "none",
      pricingSnapshotSource: "auto",
      onlyCurrentModel: false,
      providerAvailability: [
        { id: "openai", enabled: true, available: true },
        { id: "qwen-code", enabled: true, available: true },
        { id: "alibaba-coding-plan", enabled: true, available: true },
        { id: "minimax-coding-plan", enabled: true, available: true },
        { id: "copilot", enabled: true, available: true },
        { id: "google-antigravity", enabled: true, available: true },
        { id: "google-gemini-cli", enabled: true, available: true },
        { id: "chutes", enabled: true, available: true },
      ],
      providerLiveProbes: [
        {
          providerId: "openai",
          result: {
            attempted: true,
            entries: [
              {
                label: "Pro",
                name: "OpenAI Pro",
                percentRemaining: 91,
                right: "91/100",
                resetTimeIso: "2026-04-22T00:00:00.000Z",
              },
            ],
            errors: [],
          },
        },
        {
          providerId: "qwen-code",
          result: {
            attempted: true,
            entries: [
              {
                label: "Daily",
                name: "Qwen Code Daily",
                percentRemaining: 88,
                right: "120/1000",
                resetTimeIso: "2026-04-22T00:00:00.000Z",
              },
            ],
            errors: [],
          },
        },
        {
          providerId: "alibaba-coding-plan",
          result: {
            attempted: false,
            entries: [],
            errors: [],
          },
        },
        {
          providerId: "minimax-coding-plan",
          result: {
            attempted: true,
            entries: [
              {
                label: "Weekly",
                name: "MiniMax Weekly",
                percentRemaining: 63,
                right: "1600/45000",
                resetTimeIso: "2026-04-28T00:00:00.000Z",
              },
            ],
            errors: [],
          },
        },
        {
          providerId: "copilot",
          result: {
            attempted: true,
            entries: [],
            errors: [{ label: "Copilot", message: "Billing endpoint unavailable" }],
          },
        },
        {
          providerId: "google-antigravity",
          result: {
            attempted: false,
            entries: [],
            errors: [],
          },
        },
        {
          providerId: "google-gemini-cli",
          result: {
            attempted: true,
            entries: [
              {
                label: "Pro",
                name: "Gemini CLI Pro",
                percentRemaining: 77,
                right: "77 left",
                resetTimeIso: "2026-04-23T00:00:00.000Z",
              },
            ],
            errors: [],
          },
        },
        {
          providerId: "chutes",
          result: {
            attempted: true,
            entries: [],
            errors: [
              {
                label: "Chutes",
                message: "probe \u001b[31mfailed\u0007\n\twith noise",
              },
            ],
          },
        },
      ],
      generatedAtMs: Date.UTC(2026, 2, 12, 12, 45, 0),
    });

    const openaiSection = getSection(report, "openai:");
    expect(openaiSection).toContain("- live_probe: success");
    expect(openaiSection).toContain(
      "- live_entry_1: Pro 91/100 percent_remaining=91 reset_at=2026-04-22T00:00:00.000Z",
    );

    const qwenSection = getSection(report, "qwen_code:");
    expect(qwenSection).toContain("- live_probe: success");
    expect(qwenSection).toContain(
      "- live_entry_1: Daily 120/1000 percent_remaining=88 reset_at=2026-04-22T00:00:00.000Z",
    );

    const alibabaSection = getSection(report, "alibaba_coding_plan:");
    expect(alibabaSection).toContain("- live_probe: no_data");

    const minimaxSection = getSection(report, "minimax:");
    expect(minimaxSection).toContain("- auth_state: none");
    expect(minimaxSection).toContain("- live_probe: success");
    expect(minimaxSection).toContain(
      "- live_entry_1: Weekly 1600/45000 percent_remaining=63 reset_at=2026-04-28T00:00:00.000Z",
    );

    const copilotSection = getSection(report, "copilot_status_auth:");
    expect(copilotSection).toContain("- live_probe: error");
    expect(copilotSection).toContain("- live_error_1: Billing endpoint unavailable");

    const googleSection = getSection(report, "google_antigravity:");
    expect(googleSection).toContain("- live_probe: no_data");

    const geminiCliSection = getSection(report, "google_gemini_cli:");
    expect(geminiCliSection).toContain("- auth_state: missing");
    expect(geminiCliSection).toContain("- companion_package_state: missing");
    expect(geminiCliSection).toContain("- live_probe: success");
    expect(geminiCliSection).toContain(
      "- live_entry_1: Pro 77 left percent_remaining=77 reset_at=2026-04-23T00:00:00.000Z",
    );

    const chutesSection = getSection(report, "chutes:");
    expect(chutesSection).toContain("- live_probe: error");
    expect(chutesSection).toContain("- live_error_1: probe failed with noise");
    expect(chutesSection).not.toContain("\u001b[31m");
    expect(chutesSection).not.toContain("\u0007");
  });

  it("sanitizes and truncates Synthetic live probe errors", async () => {
    syntheticMocks.getSyntheticKeyDiagnostics.mockResolvedValueOnce({
      configured: true,
      source: "env:SYNTHETIC_API_KEY",
      checkedPaths: ["env:SYNTHETIC_API_KEY"],
    });

    const report = await buildSyntheticStatusReport({
      providerLiveProbes: [
        {
          providerId: "synthetic",
          result: {
            attempted: true,
            entries: [],
            errors: [
              {
                label: "Synthetic",
                message: `failure \u001b[31mwith control codes\u0007\n\t${"x".repeat(200)}`,
              },
            ],
          },
        },
      ],
    });

    expect(report).toContain("- live_probe: error");
    const errorLine = report.split("\n").find((line) => line.startsWith("- live_error_1: "));
    expect(errorLine).toBeDefined();
    expect(errorLine).toContain("failure with control codes");
    expect(errorLine).not.toContain("\u001b[31m");
    expect(errorLine).not.toContain("\u0007");
    expect(errorLine).not.toContain("\n");
    expect(errorLine).not.toContain("\t");
    expect(errorLine!.length).toBeLessThanOrEqual(140);
  });

  it("strips OSC and APC terminal escape sequences from Synthetic live probe errors", async () => {
    syntheticMocks.getSyntheticKeyDiagnostics.mockResolvedValueOnce({
      configured: true,
      source: "env:SYNTHETIC_API_KEY",
      checkedPaths: ["env:SYNTHETIC_API_KEY"],
    });

    const report = await buildSyntheticStatusReport({
      providerLiveProbes: [
        {
          providerId: "synthetic",
          result: {
            attempted: true,
            entries: [],
            errors: [
              {
                label: "Synthetic",
                message:
                  "prefix \u001b]2;window-title\u001b\\ shown \u001b]8;;https://example.test\u0007click\u001b]8;;\u0007 \u001b_hidden\u001b\\ suffix",
              },
            ],
          },
        },
      ],
    });

    const errorLine = report.split("\n").find((line) => line.startsWith("- live_error_1: "));
    expect(errorLine).toBeDefined();
    expect(errorLine).toContain("prefix shown click suffix");
    expect(errorLine).not.toContain("\u001b]");
    expect(errorLine).not.toContain("\u001b\\");
    expect(errorLine).not.toContain("window-title");
    expect(errorLine).not.toContain("https://example.test");
    expect(errorLine).not.toContain("hidden");
  });

  it("reports NanoGPT live subscription and balance diagnostics when configured", async () => {
    nanoGptMocks.getNanoGptKeyDiagnostics.mockResolvedValueOnce({
      configured: true,
      source: "env:NANOGPT_API_KEY",
      checkedPaths: ["env:NANOGPT_API_KEY"],
      authPaths: ["/tmp/auth.json"],
    });
    nanoGptMocks.queryNanoGptStatus.mockResolvedValueOnce({
      success: true,
      subscription: {
        active: false,
        state: "grace",
        enforceDailyLimit: true,
        daily: {
          used: 5,
          limit: 5000,
          remaining: 4995,
          percentRemaining: 100,
          resetTimeIso: "2026-01-02T00:00:00.000Z",
        },
        monthly: {
          used: 45,
          limit: 60000,
          remaining: 59955,
          percentRemaining: 100,
          resetTimeIso: "2026-02-01T00:00:00.000Z",
        },
        currentPeriodEndIso: "2026-02-13T23:59:59.000Z",
        graceUntilIso: "2026-01-09T00:00:00.000Z",
      },
      balance: {
        usdBalance: 129.46956147,
        usdBalanceRaw: "129.46956147",
        nanoBalanceRaw: "26.71801147",
      },
      endpointErrors: [
        {
          endpoint: "balance",
          message: "NanoGPT API error 401: Unauthorized",
        },
      ],
    });

    const { buildStatusStatusReport } = await import("../src/lib/status-status.js");
    const report = await buildStatusStatusReport({
      configSource: "test",
      configPaths: [],
      enabledProviders: ["nanogpt"],
      alibabaCodingPlanTier: "lite",
      cursorPlan: "none",
      pricingSnapshotSource: "auto",
      onlyCurrentModel: false,
      providerAvailability: [
        {
          id: "nanogpt",
          enabled: true,
          available: true,
        },
      ],
      generatedAtMs: Date.UTC(2026, 2, 12, 12, 45, 0),
    });

    expect(report).toContain("nanogpt:");
    expect(report).toContain("- api_key_configured: true");
    expect(report).toContain("- api_key_source: env:NANOGPT_API_KEY");
    expect(report).toContain("- api_key_auth_paths: /tmp/auth.json");
    expect(report).toContain("- subscription_active: false");
    expect(report).toContain("- subscription_state: grace");
    expect(report).toContain("- enforce_daily_limit: true");
    expect(report).toContain(
      "- daily_usage: 5/5000 remaining=4995 percent_remaining=100 reset_at=2026-01-02T00:00:00.000Z",
    );
    expect(report).toContain(
      "- monthly_usage: 45/60000 remaining=59955 percent_remaining=100 reset_at=2026-02-01T00:00:00.000Z",
    );
    expect(report).toContain("- billing_period_end: 2026-02-13T23:59:59.000Z");
    expect(report).toContain("- grace_until: 2026-01-09T00:00:00.000Z");
    expect(report).toContain("- balance_usd: $129.47");
    expect(report).toContain("- balance_nano: 26.71801147");
    expect(report).toContain("- live_error_balance: NanoGPT API error 401: Unauthorized");
  });

  it("reports OpenCode Go rolling, weekly, and monthly live usage when configured", async () => {
    openCodeGoMocks.getOpenCodeGoConfigDiagnostics.mockResolvedValueOnce({
      state: "configured",
      source: "env",
      missing: null,
      error: null,
      checkedPaths: ["env:OPENCODE_GO_WORKSPACE_ID", "env:OPENCODE_GO_AUTH_COOKIE"],
    });
    openCodeGoMocks.resolveOpenCodeGoConfigCached.mockResolvedValueOnce({
      state: "configured",
      source: "env",
      config: { workspaceId: "ws-123", authCookie: "cookie-abc" },
    });
    openCodeGoMocks.queryOpenCodeGoStatus.mockResolvedValueOnce({
      success: true,
      rolling: {
        usagePercent: 7,
        percentRemaining: 93,
        resetInSec: 18000,
        resetTimeIso: "2026-03-12T17:45:00.000Z",
      },
      weekly: {
        usagePercent: 22,
        percentRemaining: 78,
        resetInSec: 540000,
        resetTimeIso: "2026-03-18T18:45:00.000Z",
      },
      monthly: {
        usagePercent: 64,
        percentRemaining: 36,
        resetInSec: 2480000,
        resetTimeIso: "2026-04-10T05:38:20.000Z",
      },
    });

    const report = await buildOpenCodeGoStatusReport({
      providerAvailability: [
        {
          id: "opencode-go",
          enabled: true,
          available: true,
        },
      ],
    });

    expect(report).toContain("opencode_go:");
    expect(report).toContain("- config_state: configured");
    expect(report).toContain("- config_source: env");
    expect(report).toContain("- selected_windows: rolling,weekly,monthly");
    expect(report).toContain(
      "- rolling_usage: percent_used=7 percent_remaining=93 reset_in_sec=18000 reset_at=2026-03-12T17:45:00.000Z",
    );
    expect(report).toContain(
      "- weekly_usage: percent_used=22 percent_remaining=78 reset_in_sec=540000 reset_at=2026-03-18T18:45:00.000Z",
    );
    expect(report).toContain(
      "- monthly_usage: percent_used=64 percent_remaining=36 reset_in_sec=2480000 reset_at=2026-04-10T05:38:20.000Z",
    );
    expect(openCodeGoMocks.resolveOpenCodeGoConfigCached).toHaveBeenCalledWith({ maxAgeMs: 30_000 });
    expect(openCodeGoMocks.queryOpenCodeGoStatus).toHaveBeenCalledWith("ws-123", "cookie-abc");
  });

  it("reports available OpenCode Go live usage without failing when a default window is absent", async () => {
    openCodeGoMocks.getOpenCodeGoConfigDiagnostics.mockResolvedValueOnce({
      state: "configured",
      source: "env",
      missing: null,
      error: null,
      checkedPaths: ["env:OPENCODE_GO_WORKSPACE_ID", "env:OPENCODE_GO_AUTH_COOKIE"],
    });
    openCodeGoMocks.resolveOpenCodeGoConfigCached.mockResolvedValueOnce({
      state: "configured",
      source: "env",
      config: { workspaceId: "ws-123", authCookie: "cookie-abc" },
    });
    openCodeGoMocks.queryOpenCodeGoStatus.mockResolvedValueOnce({
      success: true,
      rolling: {
        usagePercent: 7,
        percentRemaining: 93,
        resetInSec: 18000,
        resetTimeIso: "2026-03-12T17:45:00.000Z",
      },
      weekly: {
        usagePercent: 22,
        percentRemaining: 78,
        resetInSec: 540000,
        resetTimeIso: "2026-03-18T18:45:00.000Z",
      },
    });

    const report = await buildOpenCodeGoStatusReport();

    expect(report).toContain("- selected_windows: rolling,weekly,monthly");
    expect(report).toContain(
      "- rolling_usage: percent_used=7 percent_remaining=93 reset_in_sec=18000 reset_at=2026-03-12T17:45:00.000Z",
    );
    expect(report).toContain(
      "- weekly_usage: percent_used=22 percent_remaining=78 reset_in_sec=540000 reset_at=2026-03-18T18:45:00.000Z",
    );
    expect(report).not.toContain("- monthly_usage:");
    expect(report).not.toContain("- live_fetch_error:");
  });

  it("does not report an OpenCode Go status error when a reordered full selection is missing a window", async () => {
    openCodeGoMocks.getOpenCodeGoConfigDiagnostics.mockResolvedValueOnce({
      state: "configured",
      source: "env",
      missing: null,
      error: null,
      checkedPaths: ["env:OPENCODE_GO_WORKSPACE_ID", "env:OPENCODE_GO_AUTH_COOKIE"],
    });
    openCodeGoMocks.resolveOpenCodeGoConfigCached.mockResolvedValueOnce({
      state: "configured",
      source: "env",
      config: { workspaceId: "ws-123", authCookie: "cookie-abc" },
    });
    openCodeGoMocks.queryOpenCodeGoStatus.mockResolvedValueOnce({
      success: true,
      rolling: {
        usagePercent: 7,
        percentRemaining: 93,
        resetInSec: 18000,
        resetTimeIso: "2026-03-12T17:45:00.000Z",
      },
      monthly: {
        usagePercent: 64,
        percentRemaining: 36,
        resetInSec: 2480000,
        resetTimeIso: "2026-04-10T05:38:20.000Z",
      },
    });

    const report = await buildOpenCodeGoStatusReport({
      opencodeGoWindows: ["weekly", "monthly", "rolling"],
    });

    expect(report).toContain("- selected_windows: weekly,monthly,rolling");
    expect(report).toContain(
      "- rolling_usage: percent_used=7 percent_remaining=93 reset_in_sec=18000 reset_at=2026-03-12T17:45:00.000Z",
    );
    expect(report).toContain(
      "- monthly_usage: percent_used=64 percent_remaining=36 reset_in_sec=2480000 reset_at=2026-04-10T05:38:20.000Z",
    );
    expect(report).not.toContain("- live_fetch_error:");
  });

  it("reports a clear OpenCode Go status error when a selected window is absent", async () => {
    openCodeGoMocks.getOpenCodeGoConfigDiagnostics.mockResolvedValueOnce({
      state: "configured",
      source: "env",
      missing: null,
      error: null,
      checkedPaths: ["env:OPENCODE_GO_WORKSPACE_ID", "env:OPENCODE_GO_AUTH_COOKIE"],
    });
    openCodeGoMocks.resolveOpenCodeGoConfigCached.mockResolvedValueOnce({
      state: "configured",
      source: "env",
      config: { workspaceId: "ws-123", authCookie: "cookie-abc" },
    });
    openCodeGoMocks.queryOpenCodeGoStatus.mockResolvedValueOnce({
      success: true,
      rolling: {
        usagePercent: 7,
        percentRemaining: 93,
        resetInSec: 18000,
        resetTimeIso: "2026-03-12T17:45:00.000Z",
      },
      monthly: {
        usagePercent: 64,
        percentRemaining: 36,
        resetInSec: 2480000,
        resetTimeIso: "2026-04-10T05:38:20.000Z",
      },
    });

    const report = await buildOpenCodeGoStatusReport({ opencodeGoWindows: ["weekly"] });

    expect(report).toContain("- selected_windows: weekly");
    expect(report).toContain(
      "- rolling_usage: percent_used=7 percent_remaining=93 reset_in_sec=18000 reset_at=2026-03-12T17:45:00.000Z",
    );
    expect(report).toContain("- live_fetch_error: Selected OpenCode Go dashboard window(s) missing: weekly (weeklyUsage)");
  });

  it("reports OpenCode Go invalid config details without attempting a live fetch", async () => {
    openCodeGoMocks.getOpenCodeGoConfigDiagnostics.mockResolvedValueOnce({
      state: "invalid",
      source: "/tmp/config/status-provider/opencode-go.json",
      missing: null,
      error: "Config file must contain a JSON object",
      checkedPaths: ["/tmp/config/status-provider/opencode-go.json"],
    });

    const report = await buildOpenCodeGoStatusReport();

    expect(report).toContain("opencode_go:");
    expect(report).toContain("- config_state: invalid");
    expect(report).toContain("- config_source: /tmp/config/status-provider/opencode-go.json");
    expect(report).toContain("- config_error: Config file must contain a JSON object");
    expect(report).toContain("- config_checked_paths: /tmp/config/status-provider/opencode-go.json");
    expect(openCodeGoMocks.resolveOpenCodeGoConfigCached).not.toHaveBeenCalled();
    expect(openCodeGoMocks.queryOpenCodeGoStatus).not.toHaveBeenCalled();
  });

  it("reports MiniMax auth diagnostics and live status details when configured", async () => {
    minimaxMocks.getMiniMaxAuthDiagnostics.mockResolvedValueOnce({
      state: "configured",
      source: "auth.json",
      endpoint: "international",
      checkedPaths: [],
      authPaths: ["/tmp/auth.json"],
    });
    minimaxMocks.resolveMiniMaxAuthCached.mockResolvedValueOnce({
      state: "configured",
      apiKey: "test-key",
      endpoint: "international",
    });
    minimaxMocks.queryMiniMaxStatus.mockResolvedValueOnce({
      success: true,
      entries: [
        {
          window: "five_hour",
          name: "Renamed MiniMax 5h",
          right: "70/4500",
          percentRemaining: 98,
          resetTimeIso: "2026-03-25T18:00:00.000Z",
        },
        {
          window: "weekly",
          name: "Renamed MiniMax Weekly",
          right: "105/45000",
          percentRemaining: 100,
          resetTimeIso: "2026-04-01T00:00:00.000Z",
        },
      ],
    });

    const report = await buildMiniMaxStatusReport();

    expect(report).toContain("minimax:");
    expect(report).toContain("- auth_state: configured");
    expect(report).toContain("- api_key_configured: true");
    expect(report).toContain("- api_key_source: auth.json");
    expect(report).toContain("- api_key_checked_paths: (none)");
    expect(report).toContain("- api_key_auth_paths: /tmp/auth.json");
    expect(report).toContain(
      "- five_hour_usage: 70/4500 percent_remaining=98 reset_at=2026-03-25T18:00:00.000Z",
    );
    expect(report).toContain(
      "- weekly_usage: 105/45000 percent_remaining=100 reset_at=2026-04-01T00:00:00.000Z",
    );
    expect(minimaxMocks.resolveMiniMaxAuthCached).toHaveBeenCalledWith({ maxAgeMs: 5_000 });
    expect(minimaxMocks.queryMiniMaxStatus).toHaveBeenCalledWith("test-key", {
      endpoint: "international",
      label: "MiniMax Coding Plan",
    });
  });

  it("reports MiniMax auth errors", async () => {
    minimaxMocks.getMiniMaxAuthDiagnostics.mockResolvedValueOnce({
      state: "invalid",
      source: "auth.json",
      checkedPaths: [],
      authPaths: ["/tmp/auth.json"],
      error: 'Unsupported MiniMax auth type: "oauth"',
    });

    const invalidReport = await buildMiniMaxStatusReport();

    expect(invalidReport).toContain("minimax:");
    expect(invalidReport).toContain("- auth_state: invalid");
    expect(invalidReport).toContain("- api_key_configured: false");
    expect(invalidReport).toContain("- api_key_source: auth.json");
    expect(invalidReport).toContain("- api_key_checked_paths: (none)");
    expect(invalidReport).toContain("- api_key_auth_paths: /tmp/auth.json");
    expect(invalidReport).toContain('- auth_error: Unsupported MiniMax auth type: "oauth"');
    expect(minimaxMocks.resolveMiniMaxAuthCached).not.toHaveBeenCalled();
    expect(minimaxMocks.queryMiniMaxStatus).not.toHaveBeenCalled();
  });

  it("reports MiniMax API errors", async () => {
    minimaxMocks.getMiniMaxAuthDiagnostics.mockResolvedValueOnce({
      state: "configured",
      source: "auth.json",
      endpoint: "international",
      checkedPaths: [],
      authPaths: ["/tmp/auth.json"],
    });
    minimaxMocks.resolveMiniMaxAuthCached.mockResolvedValueOnce({
      state: "configured",
      apiKey: "test-key",
      endpoint: "international",
    });
    minimaxMocks.queryMiniMaxStatus.mockResolvedValueOnce({
      success: false,
      error: "MiniMax API error 401: Unauthorized",
    });

    const fetchErrorReport = await buildMiniMaxStatusReport();

    expect(fetchErrorReport).toContain("- live_fetch_error: MiniMax API error 401: Unauthorized");
  });

  it("reports Z.ai auth diagnostics and live status details when configured", async () => {
    zaiMocks.getZaiAuthDiagnostics.mockResolvedValueOnce({
      state: "configured",
      source: "auth.json",
      checkedPaths: [],
      authPaths: ["/tmp/auth.json"],
    });
    zaiMocks.queryZaiStatus.mockResolvedValueOnce({
      success: true,
      label: "Z.ai",
      windows: {
        fiveHour: { percentRemaining: 67, resetTimeIso: "2026-03-25T18:00:00.000Z" },
        weekly: { percentRemaining: 44, resetTimeIso: "2026-04-01T00:00:00.000Z" },
        mcp: { percentRemaining: 90, resetTimeIso: "2026-04-10T00:00:00.000Z" },
      },
    });

    const report = await buildZaiStatusReport();

    expect(report).toContain("zai:");
    expect(report).toContain("- auth_state: configured");
    expect(report).toContain("- api_key_configured: true");
    expect(report).toContain("- api_key_source: auth.json");
    expect(report).toContain("- api_key_checked_paths: (none)");
    expect(report).toContain("- api_key_auth_paths: /tmp/auth.json");
    expect(report).toContain("- five_hour_remaining: 67% reset_at=2026-03-25T18:00:00.000Z");
    expect(report).toContain("- weekly_remaining: 44% reset_at=2026-04-01T00:00:00.000Z");
    expect(report).toContain("- mcp_remaining: 90% reset_at=2026-04-10T00:00:00.000Z");
  });

  it("reports Z.ai auth errors", async () => {
    zaiMocks.getZaiAuthDiagnostics.mockResolvedValueOnce({
      state: "invalid",
      source: "auth.json",
      checkedPaths: [],
      authPaths: ["/tmp/auth.json"],
      error: 'Unsupported Z.ai auth type: "oauth"',
    });

    const report = await buildZaiStatusReport();

    expect(report).toContain("zai:");
    expect(report).toContain("- auth_state: invalid");
    expect(report).toContain("- api_key_configured: false");
    expect(report).toContain("- api_key_source: auth.json");
    expect(report).toContain("- api_key_checked_paths: (none)");
    expect(report).toContain("- api_key_auth_paths: /tmp/auth.json");
    expect(report).toContain('- auth_error: Unsupported Z.ai auth type: "oauth"');
    expect(zaiMocks.queryZaiStatus).not.toHaveBeenCalled();
  });

  it("reports Z.ai endpoint errors", async () => {
    zaiMocks.getZaiAuthDiagnostics.mockResolvedValueOnce({
      state: "configured",
      source: "auth.json",
      checkedPaths: [],
      authPaths: ["/tmp/auth.json"],
    });
    zaiMocks.queryZaiStatus.mockResolvedValueOnce({
      success: false,
      error: "Z.ai API error 401: Unauthorized",
    });

    const report = await buildZaiStatusReport();

    expect(report).toContain("- live_fetch_error: Z.ai API error 401: Unauthorized");
  });

  it("reports Zhipu auth diagnostics and live status details when configured", async () => {
    zhipuMocks.getZhipuAuthDiagnostics.mockResolvedValueOnce({
      state: "configured",
      source: "auth.json",
      checkedPaths: [],
      authPaths: ["/tmp/auth.json"],
    });
    zhipuMocks.queryZhipuStatus.mockResolvedValueOnce({
      success: true,
      label: "Zhipu",
      windows: {
        fiveHour: { percentRemaining: 67, resetTimeIso: "2026-03-25T18:00:00.000Z" },
        weekly: { percentRemaining: 44, resetTimeIso: "2026-04-01T00:00:00.000Z" },
        mcp: { percentRemaining: 90, resetTimeIso: "2026-04-10T00:00:00.000Z" },
      },
    });

    const report = await buildZhipuStatusReport();

    expect(report).toContain("zhipu:");
    expect(report).toContain("- auth_state: configured");
    expect(report).toContain("- api_key_configured: true");
    expect(report).toContain("- api_key_source: auth.json");
    expect(report).toContain("- api_key_checked_paths: (none)");
    expect(report).toContain("- api_key_auth_paths: /tmp/auth.json");
    expect(report).toContain("- five_hour_remaining: 67% reset_at=2026-03-25T18:00:00.000Z");
    expect(report).toContain("- weekly_remaining: 44% reset_at=2026-04-01T00:00:00.000Z");
    expect(report).toContain("- mcp_remaining: 90% reset_at=2026-04-10T00:00:00.000Z");
  });

  it("reports Zhipu auth errors", async () => {
    zhipuMocks.getZhipuAuthDiagnostics.mockResolvedValueOnce({
      state: "invalid",
      source: "auth.json",
      checkedPaths: [],
      authPaths: ["/tmp/auth.json"],
      error: 'Unsupported Zhipu auth type: "oauth"',
    });

    const report = await buildZhipuStatusReport();

    expect(report).toContain("zhipu:");
    expect(report).toContain("- auth_state: invalid");
    expect(report).toContain("- api_key_configured: false");
    expect(report).toContain("- api_key_source: auth.json");
    expect(report).toContain("- api_key_checked_paths: (none)");
    expect(report).toContain("- api_key_auth_paths: /tmp/auth.json");
    expect(report).toContain('- auth_error: Unsupported Zhipu auth type: "oauth"');
    expect(zhipuMocks.queryZhipuStatus).not.toHaveBeenCalled();
  });

  it("reports Zhipu endpoint errors", async () => {
    zhipuMocks.getZhipuAuthDiagnostics.mockResolvedValueOnce({
      state: "configured",
      source: "auth.json",
      checkedPaths: [],
      authPaths: ["/tmp/auth.json"],
    });
    zhipuMocks.queryZhipuStatus.mockResolvedValueOnce({
      success: false,
      error: "Zhipu API error 401: Unauthorized",
    });

    const report = await buildZhipuStatusReport();

    expect(report).toContain("- live_fetch_error: Zhipu API error 401: Unauthorized");
  });

  it("reports enterprise billing scope and token compatibility notes", async () => {
    copilotMocks.getCopilotStatusAuthDiagnostics.mockReturnValueOnce({
      pat: {
        state: "valid",
        checkedPaths: ["/tmp/copilot-status-token.json"],
        selectedPath: "/tmp/copilot-status-token.json",
        tokenKind: "github_pat",
        config: {
          token: "github_pat_123",
          tier: "enterprise",
          enterprise: "acme-enterprise",
          organization: "acme-corp",
          username: "alice",
        },
      },
      oauth: {
        configured: false,
        keyName: null,
        hasRefreshToken: false,
        hasAccessToken: false,
      },
      effectiveSource: "pat",
      override: "none",
      billingMode: "enterprise_usage",
      billingScope: "enterprise",
      statusApi: "github_billing_api",
      billingApiAccessLikely: false,
      remainingTotalsState: "not_available_from_enterprise_usage",
      queryPeriod: {
        year: 2026,
        month: 1,
      },
      usernameFilter: "alice",
      tokenCompatibilityError:
        "GitHub's enterprise premium usage endpoint does not support fine-grained personal access tokens. Use a classic PAT or another supported non-fine-grained token for enterprise billing.",
    });

    const { buildStatusStatusReport } = await import("../src/lib/status-status.js");

    const report = await buildStatusStatusReport({
      configSource: "test",
      configPaths: [],
      enabledProviders: ["copilot"],
      alibabaCodingPlanTier: "lite",
      cursorPlan: "none",
      pricingSnapshotSource: "auto",
      onlyCurrentModel: false,
      providerAvailability: [
        {
          id: "copilot",
          enabled: true,
          available: true,
        },
      ],
      generatedAtMs: Date.UTC(2026, 2, 12, 12, 45, 0),
    });

    expect(report).toContain("- pat_enterprise: acme-enterprise");
    expect(report).toContain("- billing_mode: enterprise_usage");
    expect(report).toContain("- billing_scope: enterprise");
    expect(report).toContain("- status_api: github_billing_api");
    expect(report).toContain("- billing_api_access_likely: false");
    expect(report).toContain("- remaining_totals_state: not_available_from_enterprise_usage");
    expect(report).toContain(
      "- billing_usage_note: enterprise premium usage for the current billing period",
    );
    expect(report).toContain(
      "- remaining_status_note: valid enterprise billing access can query pooled enterprise usage, but it does not provide a true per-user remaining status",
    );
    expect(report).toContain(
      "- token_compatibility_error: GitHub's enterprise premium usage endpoint does not support fine-grained personal access tokens.",
    );
  });

  it("locks the early /status-provider-info section layout after the shared report-document migration", async () => {
    const { buildStatusStatusReport } = await import("../src/lib/status-status.js");

    const report = await buildStatusStatusReport({
      configSource: "defaults",
      configPaths: [],
      enabledProviders: ["copilot"],
      alibabaCodingPlanTier: "lite",
      cursorPlan: "none",
      pricingSnapshotSource: "auto",
      onlyCurrentModel: false,
      providerAvailability: [
        {
          id: "copilot",
          enabled: true,
          available: true,
        },
      ],
      generatedAtMs: Date.UTC(2026, 2, 12, 12, 45, 0),
    } as any);

    const [heading, blank, ...body] = report.split("\n");
    expect(heading).toMatch(
      /^# Status Provider Info \(status-provider v1\.2\.3\) \(\/status-provider-info\) \d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/,
    );
    expect(blank).toBe("");

    const excerpt = body.slice(0, 46).join("\n");
    expect(excerpt).toMatchInlineSnapshot(`
      "toast:
      - configSource: defaults
      - configPaths: (none)
      - precedence: built-in defaults only
      - global_config_paths: (none)
      - workspace_config_paths: (none)
      - setting_sources: (none)
      - enabledProviders: copilot
      - onlyCurrentModel: false
      - currentModel: (unknown)
      - providers:
        - copilot: enabled available

      paths:
      - opencode_dirs: data=/tmp/data config=/tmp/config cache=/tmp/cache state=/tmp/state
      - auth.json: preferred=/tmp/auth.json present=(none) candidates=/tmp/auth.json
      - qwen oauth auth configured: false
      - qwen_oauth_source: (none)
      - qwen_local_plan: (none)
      - alibaba auth configured: false
      - alibaba_api_key_source: (none)
      - alibaba_api_key_checked_paths: (none)
      - alibaba_api_key_auth_paths: /tmp/auth.json
      - alibaba coding plan fallback tier: lite
      - alibaba_coding_plan: (none)

      openai:
      - auth_configured: false
      - auth_source: (none)
      - token_status: (none)
      - token_expires_at: (none)
      - account_email: (none)
      - account_id: (none)

      anthropic:
      - cli_installed: true
      - cli_version: 1.2.3
      - auth_status: authenticated
      - status_supported: false
      - status_source: (none)
      - checked_commands: claude --version | claude auth status --json
      - message: Claude CLI auth detected, but status was unavailable from both the local CLI and Claude OAuth fallback. Claude credentials file not found at /Users/test/.claude/.credentials.json.

      cursor:
      - plan: none
      - included_api_usd: (none)"
    `);

    const titles = report
      .split("\n")
      .filter((line) => /^[a-z0-9_]+:$/u.test(line))
      .join("\n");
    expect(titles).toMatchInlineSnapshot(`
      "toast:
paths:
openai:
anthropic:
cursor:
minimax:
minimax_china:
kimi:
opencode_go:
zai:
zhipu:
synthetic:
chutes:
crof:
nanogpt:
copilot_status_auth:
google_antigravity:
google_gemini_cli:
storage:
pricing_snapshot:
supported_providers_pricing:
unpriced_models:
unknown_pricing:"
    `);
  });
});
