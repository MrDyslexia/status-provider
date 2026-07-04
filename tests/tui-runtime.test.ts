import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { collectStatusRenderData, buildCompactStatusStatusLine, buildSidebarStatusPanelLines } = vi.hoisted(
  () => ({
    collectStatusRenderData: vi.fn(),
    buildCompactStatusStatusLine: vi.fn(),
    buildSidebarStatusPanelLines: vi.fn(),
  }),
);

vi.mock("../src/lib/status-render-data.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/status-render-data.js")>(
    "../src/lib/status-render-data.js",
  );
  return {
    ...actual,
    collectStatusRenderData,
  };
});

vi.mock("../src/lib/tui-sidebar-format.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/tui-sidebar-format.js")>(
    "../src/lib/tui-sidebar-format.js",
  );
  return {
    ...actual,
    buildSidebarStatusPanelLines,
  };
});

vi.mock("../src/lib/tui-compact-format.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/tui-compact-format.js")>(
    "../src/lib/tui-compact-format.js",
  );
  return {
    ...actual,
    buildCompactStatusStatusLine,
  };
});

import {
  getTuiSessionModelMeta,
  loadSidebarPanel,
  loadTuiHomeCompactStatus,
  loadTuiSessionStatusSurfaces,
  resolveTuiCompactStatusRegistration,
  resolveTuiSurfaceRegistration,
  resolveWorkspaceDir,
} from "../src/lib/tui-runtime.js";

describe("tui runtime helpers", () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let tempDir: string;
  let worktreeDir: string;
  let nestedDir: string;
  let xdgConfigHome: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "status-provider-tui-"));
    worktreeDir = join(tempDir, "worktree");
    nestedDir = join(worktreeDir, "packages", "feature");
    xdgConfigHome = join(tempDir, "xdg-config");

    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(join(xdgConfigHome, "opencode"), { recursive: true });

    process.env.HOME = tempDir;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    process.env.XDG_DATA_HOME = join(tempDir, "xdg-data");
    process.env.XDG_CACHE_HOME = join(tempDir, "xdg-cache");
    process.env.XDG_STATE_HOME = join(tempDir, "xdg-state");
    delete process.env.OPENCODE_CONFIG_DIR;

    collectStatusRenderData.mockReset();
    buildCompactStatusStatusLine.mockReset();
    buildSidebarStatusPanelLines.mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("prefers the worktree root over the active directory for config lookup", () => {
    expect(
      resolveWorkspaceDir({
        state: {
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
        },
      } as any),
    ).toBe(worktreeDir);
  });

  it("still uses worktree root when process.cwd() differs from the active nested directory", async () => {
    process.chdir(tempDir);

    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: false,
      }),
      "utf8",
    );

    mkdirSync(join(nestedDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(nestedDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
      }),
      "utf8",
    );

    const panel = await loadSidebarPanel({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {},
      } as any,
      sessionID: "session-worktree-over-cwd",
    });

    expect(panel).toEqual({ status: "disabled", lines: [] });
    expect(collectStatusRenderData).not.toHaveBeenCalled();
  });

  it("falls back to the active directory when no worktree root is available", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
      }),
      "utf8",
    );

    mkdirSync(join(nestedDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(nestedDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: false,
      }),
      "utf8",
    );

    const panel = await loadSidebarPanel({
      api: {
        state: {
          provider: [],
          path: {
            worktree: undefined,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {},
      } as any,
      sessionID: "session-no-worktree",
    });

    expect(panel).toEqual({ status: "disabled", lines: [] });
    expect(collectStatusRenderData).not.toHaveBeenCalled();
  });

  it("loads sidebar config from the worktree root when the active directory is nested", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: false,
      }),
      "utf8",
    );

    mkdirSync(join(nestedDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(nestedDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
      }),
      "utf8",
    );

    const panel = await loadSidebarPanel({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {},
      } as any,
      sessionID: "session-1",
    });

    expect(panel).toEqual({ status: "disabled", lines: [] });
    expect(collectStatusRenderData).not.toHaveBeenCalled();
  });

  it("honors sdk-backed status config fallback when no config files are present", async () => {
    const panel = await loadSidebarPanel({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {
          config: {
            get: vi.fn().mockResolvedValue({
              data: {
                experimental: {
                  statusProvider: {
                    enabled: false,
                  },
                },
              },
            }),
          },
        },
      } as any,
      sessionID: "session-sdk-fallback",
    });

    expect(panel).toEqual({ status: "disabled", lines: [] });
    expect(collectStatusRenderData).not.toHaveBeenCalled();
  });

  it("preserves sdk-backed status config fields when no config files are present", async () => {
    collectStatusRenderData.mockResolvedValue({
      data: {
        entries: [],
        errors: [],
        sessionTokens: undefined,
      },
    });
    buildSidebarStatusPanelLines.mockReturnValue(["Status line"]);

    const panel = await loadSidebarPanel({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {
          config: {
            get: vi.fn().mockResolvedValue({
              data: {
                experimental: {
                  statusProvider: {
                    enabled: true,
                    formatStyle: "grouped",
                    percentDisplayMode: "used",
                    onlyCurrentModel: true,
                  },
                },
              },
            }),
          },
          session: {
            get: vi.fn().mockResolvedValue({
              data: {
                providerID: "copilot",
                modelID: "gpt-4.1",
              },
            }),
          },
        },
      } as any,
      sessionID: "session-sdk-fields",
    });

    expect(panel).toEqual({ status: "ready", lines: ["Status line"] });
    expect(collectStatusRenderData).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          formatStyle: "allWindows",
          percentDisplayMode: "used",
          onlyCurrentModel: true,
        }),
        formatStyle: "allWindows",
        request: expect.objectContaining({
          sessionMeta: {
            providerID: "copilot",
            modelID: "gpt-4.1",
          },
        }),
      }),
    );
    expect(buildSidebarStatusPanelLines).toHaveBeenCalledWith({
      data: {
        entries: [],
        errors: [],
        sessionTokens: undefined,
      },
      config: expect.objectContaining({
        formatStyle: "allWindows",
        percentDisplayMode: "used",
        onlyCurrentModel: true,
      }),
    });
  });

  it("keeps the sidebar enabled when enableToast is false", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
        enableToast: false,
      }),
      "utf8",
    );

    collectStatusRenderData.mockResolvedValue({
      data: {
        entries: [],
        errors: [],
        sessionTokens: undefined,
      },
    });
    buildSidebarStatusPanelLines.mockReturnValue(["Status line"]);

    const panel = await loadSidebarPanel({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {},
      } as any,
      sessionID: "session-2",
    });

    expect(panel).toEqual({ status: "ready", lines: ["Status line"] });
    expect(collectStatusRenderData).toHaveBeenCalledOnce();
    expect(buildSidebarStatusPanelLines).toHaveBeenCalledOnce();
  });

  it("shows sidebar loading instead of bare unavailable while onlyCurrentModel waits for session metadata", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
        enabledProviders: ["copilot"],
        onlyCurrentModel: true,
      }),
      "utf8",
    );

    collectStatusRenderData.mockResolvedValue({
      selection: {
        waitingForCurrentSelection: true,
      },
      data: null,
    });
    buildSidebarStatusPanelLines.mockReturnValue(["Status line"]);

    const panel = await loadSidebarPanel({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {
          session: {
            get: vi.fn().mockResolvedValue({ data: {} }),
          },
        },
      } as any,
      sessionID: "fresh-session",
    });

    expect(panel).toEqual({ status: "loading", lines: [] });
    expect(collectStatusRenderData).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          sessionMeta: {},
        }),
      }),
    );
    expect(buildSidebarStatusPanelLines).not.toHaveBeenCalled();
  });

  it("preserves canonical all-window formatStyle through sidebar runtime collection and formatting", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
        formatStyle: "allWindows",
      }),
      "utf8",
    );

    const data = {
      entries: [
        {
          name: "Copilot",
          group: "Copilot (business)",
          label: "Usage:",
          kind: "value",
          value: "9 used | 2026-01 | org=acme-corp",
          resetTimeIso: "2026-01-16T00:00:00.000Z",
        },
      ],
      errors: [],
      sessionTokens: undefined,
    };

    collectStatusRenderData.mockResolvedValue({ data });
    buildSidebarStatusPanelLines.mockReturnValue(["[Copilot] (business)"]);

    const panel = await loadSidebarPanel({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {},
      } as any,
      sessionID: "session-grouped",
    });

    expect(panel).toEqual({ status: "ready", lines: ["[Copilot] (business)"] });
    expect(collectStatusRenderData).toHaveBeenCalledWith(
      expect.objectContaining({
        formatStyle: "allWindows",
      }),
    );
    expect(buildSidebarStatusPanelLines).toHaveBeenCalledWith({
      data,
      config: expect.objectContaining({
        formatStyle: "allWindows",
      }),
    });
  });

  it("forwards weekly grouped row data unchanged from render-data to sidebar formatter", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
        formatStyle: "allWindows",
        percentDisplayMode: "used",
      }),
      "utf8",
    );

    const weeklyData = {
      entries: [
        {
          name: "Synthetic Weekly",
          group: "Synthetic",
          label: "Weekly:",
          percentRemaining: 8,
          right: "$22/$24",
          resetTimeIso: "2099-01-01T00:00:00.000Z",
        },
      ],
      errors: [],
      sessionTokens: undefined,
    };

    collectStatusRenderData.mockResolvedValue({ data: weeklyData });
    buildSidebarStatusPanelLines.mockReturnValue(["[Synthetic]", "Weekly window"]);

    const panel = await loadSidebarPanel({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {},
      } as any,
      sessionID: "session-weekly-grouped",
    });

    expect(panel).toEqual({ status: "ready", lines: ["[Synthetic]", "Weekly window"] });
    expect(buildSidebarStatusPanelLines).toHaveBeenCalledWith({
      data: weeklyData,
      config: expect.objectContaining({
        formatStyle: "allWindows",
        percentDisplayMode: "used",
      }),
    });
  });

  it("prefers api.client.config.providers over sidebar state providers", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
      }),
      "utf8",
    );

    const runtimeProviders = vi.fn().mockResolvedValue({
      data: { providers: [{ id: "copilot" }, { id: "openai" }] },
    });

    collectStatusRenderData.mockImplementation(async ({ client }) => {
      const response = await client.config.providers();
      expect(response).toEqual({
        data: { providers: [{ id: "copilot" }, { id: "openai" }] },
      });
      return {
        data: {
          entries: [],
          errors: [],
          sessionTokens: undefined,
        },
      };
    });
    buildSidebarStatusPanelLines.mockReturnValue(["Status line"]);

    const panel = await loadSidebarPanel({
      api: {
        state: {
          provider: [{ id: "stale-state-provider" }],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {
          config: {
            providers: runtimeProviders,
          },
        },
      } as any,
      sessionID: "session-2b",
    });

    expect(panel).toEqual({ status: "ready", lines: ["Status line"] });
    expect(runtimeProviders).toHaveBeenCalledOnce();
  });

  it("falls back to session messages when session.get fails under onlyCurrentModel", async () => {
    const sessionGet = vi.fn().mockRejectedValue(new Error("boom"));

    const meta = await getTuiSessionModelMeta(
      {
        client: {
          session: {
            get: sessionGet,
          },
        },
        state: {
          session: {
            messages: () => [
              { providerID: "openai", modelID: "gpt-4.1" },
              { model: { providerID: "cursor", modelID: "claude-3.7-sonnet" } },
            ],
          },
        },
      } as any,
      "session-3",
    );

    expect(sessionGet).toHaveBeenCalledWith({ path: { id: "session-3" } });
    expect(meta).toEqual({
      providerID: "cursor",
      modelID: "claude-3.7-sonnet",
    });
  });

  it("resolves compact registration and suppresses native provider status clients", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
        tuiCompactStatus: {
          enabled: true,
          homeBottom: true,
          sessionPrompt: true,
          suppressWhenNativeProviderStatus: true,
        },
      }),
      "utf8",
    );

    const registration = await resolveTuiCompactStatusRegistration({
      state: {
        provider: [],
        path: {
          worktree: worktreeDir,
          directory: nestedDir,
        },
        session: {
          messages: () => [],
        },
      },
      client: {
        experimental: {
          providerStatus: {},
        },
      },
    } as any);

    expect(registration).toEqual({
      enabled: false,
      homeBottom: false,
      sessionPrompt: false,
      hasNativeProviderStatus: true,
      suppressedByNativeProviderStatus: true,
    });
    expect(collectStatusRenderData).not.toHaveBeenCalled();
  });

  it("resolves sidebar independently from compact native-provider suppression", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
        tuiSidebarPanel: {
          enabled: true,
        },
        tuiCompactStatus: {
          enabled: true,
          homeBottom: true,
          sessionPrompt: true,
          suppressWhenNativeProviderStatus: true,
        },
      }),
      "utf8",
    );

    const registration = await resolveTuiSurfaceRegistration({
      state: {
        provider: [],
        path: {
          worktree: worktreeDir,
          directory: nestedDir,
        },
        session: {
          messages: () => [],
        },
      },
      client: {
        experimental: {
          providerStatus: {},
        },
      },
    } as any);

    expect(registration).toEqual({
      sidebar: {
        enabled: true,
      },
      compact: {
        enabled: false,
        homeBottom: false,
        sessionPrompt: false,
        hasNativeProviderStatus: true,
        suppressedByNativeProviderStatus: true,
      },
    });
    expect(collectStatusRenderData).not.toHaveBeenCalled();
  });

  it("loads compact session surface while returning disabled sidebar when sidebar config is off", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
        percentDisplayMode: "used",
        tuiSidebarPanel: {
          enabled: false,
        },
        tuiCompactStatus: {
          enabled: true,
          sessionPrompt: true,
          maxWidth: 42,
        },
      }),
      "utf8",
    );

    const data = {
      entries: [
        {
          name: "Copilot 5h",
          percentRemaining: 18,
        },
      ],
      errors: [],
      sessionTokens: undefined,
    };
    collectStatusRenderData.mockResolvedValue({ data });
    buildSidebarStatusPanelLines.mockReturnValue(["Sidebar status"]);
    buildCompactStatusStatusLine.mockReturnValue("Compact status");

    const surfaces = await loadTuiSessionStatusSurfaces({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {},
      } as any,
      sessionID: "compact-sidebar-off",
    });

    expect(surfaces).toEqual({
      sidebar: { status: "disabled", lines: [] },
      compact: { status: "ready", text: "Compact status" },
    });
    expect(collectStatusRenderData).toHaveBeenCalledOnce();
    expect(buildSidebarStatusPanelLines).not.toHaveBeenCalled();
    expect(buildCompactStatusStatusLine).toHaveBeenCalledWith({
      data,
      percentDisplayMode: "used",
      maxWidth: 42,
    });
  });

  it("skips session status collection when sidebar and session compact are disabled", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
        tuiSidebarPanel: {
          enabled: false,
        },
        tuiCompactStatus: {
          enabled: true,
          sessionPrompt: false,
        },
      }),
      "utf8",
    );

    const surfaces = await loadTuiSessionStatusSurfaces({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {},
      } as any,
      sessionID: "all-session-surfaces-off",
    });

    expect(surfaces).toEqual({
      sidebar: { status: "disabled", lines: [] },
      compact: { status: "disabled" },
    });
    expect(collectStatusRenderData).not.toHaveBeenCalled();
    expect(buildSidebarStatusPanelLines).not.toHaveBeenCalled();
    expect(buildCompactStatusStatusLine).not.toHaveBeenCalled();
  });

  it("loads sidebar and compact session surfaces from one collection", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
        percentDisplayMode: "used",
        onlyCurrentModel: true,
        tuiCompactStatus: {
          enabled: true,
          sessionPrompt: true,
          maxWidth: 42,
        },
      }),
      "utf8",
    );

    const data = {
      entries: [
        {
          name: "Copilot 5h",
          percentRemaining: 18,
        },
      ],
      errors: [],
      sessionTokens: undefined,
    };
    collectStatusRenderData.mockResolvedValue({ data });
    buildSidebarStatusPanelLines.mockReturnValue(["Sidebar status"]);
    buildCompactStatusStatusLine.mockReturnValue("Compact status");

    const surfaces = await loadTuiSessionStatusSurfaces({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {
          session: {
            get: vi.fn().mockResolvedValue({
              data: {
                providerID: "copilot",
                modelID: "gpt-4.1",
              },
            }),
          },
        },
      } as any,
      sessionID: "compact-session",
    });

    expect(surfaces).toEqual({
      sidebar: { status: "ready", lines: ["Sidebar status"] },
      compact: { status: "ready", text: "Compact status" },
    });
    expect(collectStatusRenderData).toHaveBeenCalledOnce();
    expect(collectStatusRenderData).toHaveBeenCalledWith(
      expect.objectContaining({
        surfaceExplicitProviderIssues: true,
        config: expect.objectContaining({
          onlyCurrentModel: true,
          percentDisplayMode: "used",
        }),
        request: expect.objectContaining({
          sessionID: "compact-session",
          sessionMeta: {
            providerID: "copilot",
            modelID: "gpt-4.1",
          },
        }),
      }),
    );
    expect(buildSidebarStatusPanelLines).toHaveBeenCalledWith({
      data,
      config: expect.objectContaining({
        percentDisplayMode: "used",
      }),
    });
    expect(buildCompactStatusStatusLine).toHaveBeenCalledWith({
      data,
      percentDisplayMode: "used",
      maxWidth: 42,
    });
  });

  it("uses compact fallback text when session collection has no data", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
        tuiCompactStatus: {
          enabled: true,
          sessionPrompt: true,
        },
      }),
      "utf8",
    );

    collectStatusRenderData.mockResolvedValue({ data: null });

    const surfaces = await loadTuiSessionStatusSurfaces({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {},
      } as any,
      sessionID: "compact-no-data",
    });

    expect(surfaces).toEqual({
      sidebar: { status: "ready", lines: [] },
      compact: { status: "ready", text: "Status unavailable" },
    });
    expect(buildCompactStatusStatusLine).not.toHaveBeenCalled();
  });

  it("marks both session surfaces loading while waiting for current selection", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
        onlyCurrentModel: true,
        tuiCompactStatus: {
          enabled: true,
          sessionPrompt: true,
        },
      }),
      "utf8",
    );

    collectStatusRenderData.mockResolvedValue({
      selection: {
        waitingForCurrentSelection: true,
      },
      data: null,
    });

    const surfaces = await loadTuiSessionStatusSurfaces({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {
          session: {
            get: vi.fn().mockResolvedValue({ data: {} }),
          },
        },
      } as any,
      sessionID: "waiting-session",
    });

    expect(surfaces).toEqual({
      sidebar: { status: "loading", lines: [] },
      compact: { status: "loading" },
    });
    expect(buildSidebarStatusPanelLines).not.toHaveBeenCalled();
    expect(buildCompactStatusStatusLine).not.toHaveBeenCalled();
  });

  it("uses compact fallback text when home compact formatting returns empty", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
        tuiCompactStatus: {
          enabled: true,
          homeBottom: true,
        },
      }),
      "utf8",
    );

    const data = {
      entries: [],
      errors: [],
      sessionTokens: undefined,
    };
    collectStatusRenderData.mockResolvedValue({ data });
    buildCompactStatusStatusLine.mockReturnValue("");

    const compact = await loadTuiHomeCompactStatus({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {},
      } as any,
    });

    expect(compact).toEqual({ status: "ready", text: "Status unavailable" });
    expect(buildCompactStatusStatusLine).toHaveBeenCalledWith({
      data,
      percentDisplayMode: "remaining",
      maxWidth: 96,
    });
  });

  it("loads home compact with an onlyCurrentModel false config copy", async () => {
    mkdirSync(join(worktreeDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(worktreeDir, "status-provider", "config.json"),
      JSON.stringify({
        enabled: true,
        onlyCurrentModel: true,
        showSessionTokens: true,
        percentDisplayMode: "used",
        tuiCompactStatus: {
          enabled: true,
          homeBottom: true,
          maxWidth: 40,
        },
      }),
      "utf8",
    );

    const data = {
      entries: [
        {
          name: "Copilot 5h",
          percentRemaining: 25,
        },
      ],
      errors: [],
      sessionTokens: undefined,
    };
    collectStatusRenderData.mockImplementation(async ({ config, request }) => {
      expect(config).toEqual(
        expect.objectContaining({
          onlyCurrentModel: false,
          showSessionTokens: false,
          percentDisplayMode: "used",
        }),
      );
      expect(request).toEqual({
        sessionID: undefined,
        sessionMeta: undefined,
      });
      return { data };
    });
    buildCompactStatusStatusLine.mockReturnValue("Home compact status");

    const compact = await loadTuiHomeCompactStatus({
      api: {
        state: {
          provider: [],
          path: {
            worktree: worktreeDir,
            directory: nestedDir,
          },
          session: {
            messages: () => [],
          },
        },
        client: {},
      } as any,
    });

    expect(compact).toEqual({ status: "ready", text: "Home compact status" });
    expect(collectStatusRenderData).toHaveBeenCalledOnce();
    expect(buildCompactStatusStatusLine).toHaveBeenCalledWith({
      data,
      percentDisplayMode: "used",
      maxWidth: 40,
    });
    expect(buildSidebarStatusPanelLines).not.toHaveBeenCalled();
  });
});
