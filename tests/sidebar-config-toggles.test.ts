import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_RUNTIME_ROOT = "/tmp/status-provider-sidebar-toggle-tests";

const { mockProviders } = vi.hoisted(() => ({
  mockProviders: [] as any[],
}));

vi.mock("../src/providers/registry.js", () => ({
  getProviders: () => mockProviders,
  getOrderedProviders: (config: {
    enabledProviders?: string[] | "auto";
    providerOrder?: string[];
  }) => {
    const all = mockProviders;
    const order = config.providerOrder?.length ? config.providerOrder : all.map((p: any) => p.id);
    const enabled =
      config.enabledProviders === "auto"
        ? new Set(order)
        : new Set(config.enabledProviders ?? order);
    const ordered: any[] = [];
    const seen = new Set<string>();
    for (const rawId of order) {
      const id = (rawId as string).toLowerCase();
      if (seen.has(id)) continue;
      const provider = all.find((p: any) => p.id === id);
      if (!provider || !enabled.has(id)) continue;
      seen.add(id);
      ordered.push(provider);
    }
    return ordered;
  },
}));

vi.mock("../src/lib/opencode-runtime-paths.js", () => ({
  getOpencodeRuntimeDirs: () => ({
    dataDir: `${TEST_RUNTIME_ROOT}/data`,
    configDir: `${TEST_RUNTIME_ROOT}/config`,
    cacheDir: `${TEST_RUNTIME_ROOT}/cache`,
    stateDir: `${TEST_RUNTIME_ROOT}/state`,
  }),
  getOpencodeRuntimeDirCandidates: () => ({
    configDirs: [`${TEST_RUNTIME_ROOT}/config/opencode`],
    dataDirs: [`${TEST_RUNTIME_ROOT}/data/opencode`],
    cacheDirs: [`${TEST_RUNTIME_ROOT}/cache/opencode`],
    stateDirs: [`${TEST_RUNTIME_ROOT}/state/opencode`],
  }),
}));

vi.mock("../src/lib/status-render-data.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/status-render-data.js")>(
    "../src/lib/status-render-data.js",
  );
  return {
    ...actual,
    collectStatusRenderData: vi.fn(),
  };
});

vi.mock("../src/lib/tui-sidebar-format.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/tui-sidebar-format.js")>(
    "../src/lib/tui-sidebar-format.js",
  );
  return {
    ...actual,
    buildSidebarStatusPanelLines: vi.fn(),
  };
});

vi.mock("../src/lib/tui-compact-format.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/tui-compact-format.js")>(
    "../src/lib/tui-compact-format.js",
  );
  return {
    ...actual,
    buildCompactStatusStatusLine: vi.fn(),
  };
});

import { loadSidebarPanel, loadTuiSessionStatusSurfaces } from "../src/lib/tui-runtime.js";
import { collectStatusRenderData } from "../src/lib/status-render-data.js";
import { buildSidebarStatusPanelLines } from "../src/lib/tui-sidebar-format.js";
import { buildCompactStatusStatusLine } from "../src/lib/tui-compact-format.js";
import { __resetStatusStateForTests } from "../src/lib/status-state.js";

function makeApi() {
  return {
    state: {
      provider: [],
      path: {
        worktree: worktreeDir,
        directory: worktreeDir,
      },
      session: {
        messages: () => [],
      },
    },
    client: {},
  } as any;
}

function writeConfig(config: any) {
  mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
  writeFileSync(
    join(worktreeDir, "status-provider", "config.json"),
    JSON.stringify(config),
    "utf8",
  );
}

let tempDir: string;
let worktreeDir: string;
let xdgConfigHome: string;

describe("sidebar config toggles", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "status-provider-toggle-"));
    worktreeDir = join(tempDir, "worktree");
    xdgConfigHome = join(tempDir, "xdg-config");

    mkdirSync(worktreeDir, { recursive: true });
    mkdirSync(join(xdgConfigHome, "opencode"), { recursive: true });

    process.env.HOME = tempDir;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    process.env.XDG_DATA_HOME = join(tempDir, "xdg-data");
    process.env.XDG_CACHE_HOME = join(tempDir, "xdg-cache");
    process.env.XDG_STATE_HOME = join(tempDir, "xdg-state");
    delete process.env.OPENCODE_CONFIG_DIR;

    mockProviders.length = 0;
    vi.mocked(collectStatusRenderData).mockReset();
    vi.mocked(buildSidebarStatusPanelLines).mockReset();
    vi.mocked(buildCompactStatusStatusLine).mockReset();
    __resetStatusStateForTests();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("enabled", () => {
    it("disabled disables the sidebar entirely", async () => {
      writeConfig({ enabled: false });

      const panel = await loadSidebarPanel({
        api: makeApi(),
        sessionID: "session-1",
      });

      expect(panel).toEqual({ status: "disabled", lines: [] });
      expect(collectStatusRenderData).not.toHaveBeenCalled();
      expect(buildSidebarStatusPanelLines).not.toHaveBeenCalled();
    });
  });

  describe("tuiSidebarPanel", () => {
    it("disabled hides the sidebar but still collects compact status", async () => {
      writeConfig({
        enabled: true,
        tuiSidebarPanel: { enabled: false },
        tuiCompactStatus: { enabled: true, sessionPrompt: true },
      });

      const data = {
        entries: [{ name: "Copilot", percentRemaining: 50 }],
        errors: [],
        sessionTokens: undefined,
      };
      vi.mocked(collectStatusRenderData).mockResolvedValue({ data } as any);
      vi.mocked(buildCompactStatusStatusLine).mockReturnValue("Compact status");

      const surfaces = await loadTuiSessionStatusSurfaces({
        api: makeApi(),
        sessionID: "session-2",
      });

      expect(surfaces.sidebar).toEqual({ status: "disabled", lines: [] });
      expect(surfaces.compact).toEqual({ status: "ready", text: "Compact status" });
      expect(buildSidebarStatusPanelLines).not.toHaveBeenCalled();
      expect(buildCompactStatusStatusLine).toHaveBeenCalledWith({
        data,
        percentDisplayMode: "remaining",
        maxWidth: 96,
      });
    });
  });

  describe("showSessionTokens", () => {
    const sessionTokens = {
      totalInput: 100,
      totalOutput: 20,
      models: [{ modelID: "openai/gpt-5.4-mini", input: 100, output: 20 }],
    };

    it("passes session tokens to the sidebar formatter when enabled", async () => {
      writeConfig({ enabled: true, showSessionTokens: true });

      const data = {
        entries: [{ name: "Copilot", percentRemaining: 50 }],
        errors: [],
        sessionTokens,
      };
      vi.mocked(collectStatusRenderData).mockResolvedValue({ data } as any);
      vi.mocked(buildSidebarStatusPanelLines).mockReturnValue(["Status line"]);

      await loadSidebarPanel({
        api: makeApi(),
        sessionID: "session-3",
      });

      expect(buildSidebarStatusPanelLines).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sessionTokens }),
        }),
      );
    });

    it("omits session tokens from the sidebar formatter when disabled", async () => {
      writeConfig({ enabled: true, showSessionTokens: false });

      const data = {
        entries: [{ name: "Copilot", percentRemaining: 50 }],
        errors: [],
        sessionTokens: undefined,
      };
      vi.mocked(collectStatusRenderData).mockResolvedValue({ data } as any);
      vi.mocked(buildSidebarStatusPanelLines).mockReturnValue(["Status line"]);

      await loadSidebarPanel({
        api: makeApi(),
        sessionID: "session-4",
      });

      expect(buildSidebarStatusPanelLines).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sessionTokens: undefined }),
        }),
      );
    });
  });

  describe("enabledProviders", () => {
    it("only considers explicitly listed providers", async () => {
      const openai = {
        id: "openai",
        isAvailable: vi.fn().mockResolvedValue(true),
        fetch: vi.fn().mockResolvedValue({
          attempted: true,
          entries: [{ name: "OpenAI", percentRemaining: 50 }],
          errors: [],
        }),
      };
      const copilot = {
        id: "copilot",
        isAvailable: vi.fn().mockResolvedValue(true),
        fetch: vi.fn(),
      };
      mockProviders.push(openai, copilot);

      writeConfig({ enabled: true, enabledProviders: ["openai"] });

      vi.mocked(collectStatusRenderData).mockImplementation(async ({ config }) => {
        expect(config.enabledProviders).toEqual(["openai"]);
        return {
          data: {
            entries: [{ name: "OpenAI", percentRemaining: 50 }],
            errors: [],
            sessionTokens: undefined,
          },
        } as any;
      });
      vi.mocked(buildSidebarStatusPanelLines).mockReturnValue(["Status line"]);

      await loadSidebarPanel({
        api: makeApi(),
        sessionID: "session-5",
      });

      expect(openai.isAvailable).not.toHaveBeenCalled();
      expect(copilot.isAvailable).not.toHaveBeenCalled();
      expect(buildSidebarStatusPanelLines).toHaveBeenCalled();
    });
  });

  describe("providerOrder", () => {
    it("orders active providers by providerOrder", async () => {
      const copilot = { id: "copilot" };
      const openai = { id: "openai" };
      mockProviders.push(copilot, openai);

      writeConfig({
        enabled: true,
        enabledProviders: ["copilot", "openai"],
        providerOrder: ["openai", "copilot"],
      });

      vi.mocked(collectStatusRenderData).mockImplementation(async ({ config }) => {
        expect(config.providerOrder).toEqual(["openai", "copilot"]);
        return { data: { entries: [], errors: [], sessionTokens: undefined } } as any;
      });

      await loadSidebarPanel({
        api: makeApi(),
        sessionID: "session-6",
      });

      expect(collectStatusRenderData).toHaveBeenCalled();
    });
  });
});
