import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJsonOrJsonc } from "../src/lib/jsonc.js";

import {
  applyInitInstallerPlan,
  planInitInstaller,
  runInitInstaller,
} from "../src/lib/init-installer.js";

function readJson(path: string): any {
  const content = readFileSync(path, "utf8");
  return parseJsonOrJsonc(content, path.endsWith(".jsonc"));
}

function createPromptStub(params: {
  selectValues?: unknown[];
  multiselectValues?: unknown[];
  confirmValues?: unknown[];
}) {
  const selectValues = [...(params.selectValues ?? [])];
  const multiselectValues = [...(params.multiselectValues ?? [])];
  const confirmValues = [...(params.confirmValues ?? [])];
  const selectCalls: { message: string; options: unknown[] }[] = [];
  const multiselectCalls: { message: string; required?: boolean; options: unknown[] }[] = [];
  const outroCalls: string[] = [];

  return {
    intro: () => {},
    outro: (message: string) => {
      outroCalls.push(message);
    },
    select: async (options: { message: string; options: unknown[] }) => {
      selectCalls.push(options);
      return selectValues.shift();
    },
    multiselect: async (options: { message: string; required?: boolean; options: unknown[] }) => {
      multiselectCalls.push(options);
      return multiselectValues.shift();
    },
    confirm: async () => confirmValues.shift(),
    isCancel: (value: unknown) => value === Symbol.for("cancel"),
    log: {
      info: () => {},
      success: () => {},
      error: () => {},
    },
    selectCalls,
    multiselectCalls,
    outroCalls,
  };
}

describe("init installer planning and merge behavior", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "status-provider-init-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates project opencode.json at the worktree root for toast mode", async () => {
    const projectDir = join(tempDir, "project");
    const nestedDir = join(projectDir, "packages", "feature");
    mkdirSync(join(projectDir, ".git"), { recursive: true });
    mkdirSync(nestedDir, { recursive: true });

    const plan = await planInitInstaller({
      cwd: nestedDir,
      selections: {
        scope: "project",
        statusUi: ["toast"],
        providerMode: "manual",
        manualProviders: ["openai", "anthropic"],
        formatStyle: "allWindows",
        percentDisplayMode: "used",
        showSessionTokens: false,
      },
    });

    expect(plan.baseDir).toBe(projectDir);
    expect(plan.edits.map((edit) => edit.kind)).toEqual(["opencode", "status"]);
    expect(plan.quickSetupNotes).toEqual([
      {
        providerId: "anthropic",
        label: "Anthropic",
        anchor: "anthropic-quick-setup",
      },
    ]);

    const result = await applyInitInstallerPlan(plan);
    expect(result.writtenPaths).toEqual([
      join(projectDir, "opencode.json"),
      join(projectDir, "status-provider", "config.json"),
    ]);

    const config = readJson(join(projectDir, "opencode.json"));
    expect(config).toMatchObject({
      $schema: "https://opencode.ai/config.json",
      plugin: ["status-provider"],
    });
    expect(config.experimental).toBeUndefined();

    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(statusConfig).toMatchObject({
      enableToast: true,
      enabledProviders: ["openai", "anthropic"],
      formatStyle: "allWindows",
      percentDisplayMode: "used",
      showSessionTokens: false,
    });
  });

  it("does not write legacy experimental.statusProvider", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["toast"],
        providerMode: "manual",
        manualProviders: ["openai"],
        formatStyle: "allWindows",
        percentDisplayMode: "used",
        showSessionTokens: false,
      },
    });

    const opencodeEdit = plan.edits.find((edit) => edit.kind === "opencode");
    expect(opencodeEdit?.addedKeys).not.toContain("experimental.statusProvider");

    await applyInitInstallerPlan(plan);

    const opencode = readJson(join(projectDir, "opencode.json"));
    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(opencode.experimental).toBeUndefined();
    expect(statusConfig).toMatchObject({
      enableToast: true,
      enabledProviders: ["openai"],
      formatStyle: "allWindows",
      percentDisplayMode: "used",
      showSessionTokens: false,
    });
  });

  it("preserves unrelated values, dedupes plugins, and adds formatStyle without deleting legacy toastStyle", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "opencode.jsonc"),
      `{
        // preserve existing user values
        "$schema": "https://custom.local/config.json",
        "plugin": [
          "file:///Users/test/Downloads/GitHub/status-provider/dist/index.js"
        ],
        "experimental": {
          "statusProvider": {
            "toastStyle": "grouped",
            "enableToast": true,
            "showSessionTokens": true,
            "enabledProviders": ["openai"]
          }
        },
        "other": {
          "keep": true
        },
      }`,
      "utf8",
    );

    writeFileSync(
      join(projectDir, "tui.json"),
      JSON.stringify({
        plugin: ["file:///Users/test/Downloads/GitHub/status-provider/dist/tui.tsx"],
        tui: {
          plugin: [["some-other-plugin", { debug: true }]],
        },
        theme: "dark",
      }),
      "utf8",
    );

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["sidebar"],
        providerMode: "manual",
        manualProviders: ["cursor", "opencode-go"],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: false,
      },
    });

    const opencodeEdit = plan.edits.find((edit) => edit.kind === "opencode");
    const tuiEdit = plan.edits.find((edit) => edit.kind === "tui");
    expect(opencodeEdit?.warnings).toContain(
      "Existing JSONC comments/trailing commas will be stripped.",
    );
    expect(opencodeEdit?.addedPlugins).toEqual([]);
    expect(opencodeEdit?.addedKeys).toEqual(
      [],
    );
    expect(opencodeEdit?.skippedValues).toEqual(
      expect.arrayContaining([
        "plugin already includes status-provider",
      ]),
    );
    const statusEdit = plan.edits.find((edit) => edit.kind === "status");
    expect(statusEdit?.addedKeys).toEqual(
      expect.arrayContaining([
        "status-provider/config.json",
        "statusProvider.enableToast",
        "statusProvider.showSessionTokens",
        "statusProvider.enabledProviders",
        "statusProvider.formatStyle",
        "statusProvider.percentDisplayMode",
        "statusProvider.tuiSidebarPanel.enabled",
      ]),
    );
    expect(statusEdit?.updatedKeys).toEqual([]);
    expect(statusEdit?.skippedValues).toEqual([]);
    expect(tuiEdit?.addedPlugins).toEqual([]);
    expect(tuiEdit?.skippedValues).toContain("tui config already includes status-provider");

    await applyInitInstallerPlan(plan);

    const opencode = readJson(join(projectDir, "opencode.jsonc"));
    expect(opencode.other).toEqual({ keep: true });
    expect(opencode.plugin).toHaveLength(1);
    expect(opencode.experimental.statusProvider).toMatchObject({
      toastStyle: "grouped",
      enableToast: true,
      showSessionTokens: true,
      enabledProviders: ["openai"],
    });
    expect(opencode.experimental.statusProvider.formatStyle).toBeUndefined();
    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(statusConfig).toMatchObject({
      formatStyle: "singleWindow",
      percentDisplayMode: "remaining",
      enableToast: false,
      showSessionTokens: false,
      enabledProviders: ["cursor", "opencode-go"],
    });

    const tui = readJson(join(projectDir, "tui.json"));
    expect(tui.$schema).toBe("https://opencode.ai/tui.json");
    expect(tui.theme).toBe("dark");
    expect(tui.plugin).toHaveLength(1);
    expect(tui.tui.plugin).toHaveLength(1);
  });

  it("adds the server plugin when opencode config only references the tui entrypoint", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "opencode.json"),
      JSON.stringify({
        plugin: ["file:///Users/test/Downloads/GitHub/status-provider/dist/tui.tsx"],
      }),
      "utf8",
    );

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["toast"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });

    const opencodeEdit = plan.edits.find((edit) => edit.kind === "opencode");
    expect(opencodeEdit?.addedPlugins).toEqual(["plugin: status-provider"]);

    await applyInitInstallerPlan(plan);

    const opencode = readJson(join(projectDir, "opencode.json"));
    expect(opencode.plugin).toEqual([
      "file:///Users/test/Downloads/GitHub/status-provider/dist/tui.tsx",
      "status-provider",
    ]);
  });

  it("writes sidebar disabled when selected UI omits sidebar and tui config already has the plugin", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "tui.json"),
      JSON.stringify({
        plugin: ["status-provider"],
      }),
      "utf8",
    );

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["toast"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });

    expect(plan.edits.map((edit) => edit.kind)).toEqual(["opencode", "status"]);

    await applyInitInstallerPlan(plan);

    const tui = readJson(join(projectDir, "tui.json"));
    expect(tui).toEqual({ plugin: ["status-provider"] });
    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(statusConfig.tuiSidebarPanel).toEqual({ enabled: false });
  });

  it("adds the tui plugin when tui config only references the server entrypoint", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "tui.json"),
      JSON.stringify({
        plugin: ["file:///Users/test/Downloads/GitHub/status-provider/dist/index.js"],
      }),
      "utf8",
    );

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["sidebar"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });

    const tuiEdit = plan.edits.find((edit) => edit.kind === "tui");
    expect(tuiEdit?.addedPlugins).toEqual(["plugin: status-provider"]);

    await applyInitInstallerPlan(plan);

    const tui = readJson(join(projectDir, "tui.json"));
    expect(tui.plugin).toEqual([
      "file:///Users/test/Downloads/GitHub/status-provider/dist/index.js",
      "status-provider",
    ]);
  });

  it("creates both opencode and tui targets for sidebar mode and appends missing plugins", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["sidebar"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });

    expect(plan.edits.map((edit) => edit.kind)).toEqual(["opencode", "status", "tui"]);

    await applyInitInstallerPlan(plan);

    const opencode = readJson(join(projectDir, "opencode.json"));
    const tui = readJson(join(projectDir, "tui.json"));

    expect(opencode.plugin).toEqual(["status-provider"]);
    expect(opencode.experimental).toBeUndefined();
    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(statusConfig).toMatchObject({
      enableToast: false,
      enabledProviders: "auto",
      formatStyle: "singleWindow",
      percentDisplayMode: "remaining",
      showSessionTokens: true,
      tuiSidebarPanel: { enabled: true },
    });
    expect(tui).toEqual({
      $schema: "https://opencode.ai/tui.json",
      plugin: ["status-provider"],
    });
  });

  it("leaves compact TUI status alone when not selected for fresh sidebar installs", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["sidebar"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });

    expect(plan.summaryLines).not.toContain("Compact status mode: Home bottom + session prompt");
    expect(plan.edits.map((edit) => edit.kind)).toEqual(["opencode", "status", "tui"]);

    await applyInitInstallerPlan(plan);

    expect(existsSync(join(projectDir, "opencode.json"))).toBe(true);
    expect(existsSync(join(projectDir, "tui.json"))).toBe(true);
    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(statusConfig.tuiSidebarPanel).toEqual({ enabled: true });
    expect(statusConfig.tuiCompactStatus).toBeUndefined();
  });

  it("writes compact TUI config when compact status is selected", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["sidebar", "compact_status"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });

    expect(plan.summaryLines).toContain("Status UI: Sidebar + Compact status");
    expect(plan.summaryLines).toContain("Compact status mode: Home bottom + session prompt");

    await applyInitInstallerPlan(plan);

    expect(existsSync(join(projectDir, "tui.json"))).toBe(true);
    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(statusConfig.tuiSidebarPanel).toEqual({ enabled: true });
    expect(statusConfig.tuiCompactStatus).toEqual({
      enabled: true,
      homeBottom: true,
      sessionPrompt: true,
      suppressWhenNativeProviderStatus: true,
    });
  });

  it("keeps compact-only selection independent from sidebar", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["compact_status"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });

    expect(plan.selections.statusUi).toEqual(["compact_status"]);
    expect(plan.summaryLines).toContain("Status UI: Compact status");
    expect(plan.edits.map((edit) => edit.kind)).toEqual(["opencode", "status", "tui"]);

    await applyInitInstallerPlan(plan);

    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(statusConfig.enableToast).toBe(false);
    expect(statusConfig.tuiSidebarPanel).toEqual({ enabled: false });
    expect(statusConfig.tuiCompactStatus).toEqual({
      enabled: true,
      homeBottom: true,
      sessionPrompt: true,
      suppressWhenNativeProviderStatus: true,
    });
  });

  it("updates existing sidebar enabled value for compact-only selection", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(join(projectDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(projectDir, "status-provider", "config.json"),
      JSON.stringify({
        enableToast: false,
        enabledProviders: "auto",
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
        tuiSidebarPanel: {
          enabled: true,
        },
      }),
      "utf8",
    );

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["compact_status"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });

    const statusEdit = plan.edits.find((edit) => edit.kind === "status");
    expect(statusEdit?.updatedKeys).toContain("statusProvider.tuiSidebarPanel.enabled");
    expect(statusEdit?.skippedValues).not.toContain(
      "statusProvider.tuiSidebarPanel.enabled preserved existing value",
    );

    await applyInitInstallerPlan(plan);

    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(statusConfig.tuiSidebarPanel).toEqual({ enabled: false });
    expect(statusConfig.tuiCompactStatus).toMatchObject({ enabled: true });
  });

  it("normalizes empty and mixed none status UI choices defensively", async () => {
    const emptyPlan = await planInitInstaller({
      cwd: tempDir,
      selections: {
        scope: "project",
        statusUi: [],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });
    expect(emptyPlan.selections.statusUi).toEqual(["none"]);
    expect(emptyPlan.edits.map((edit) => edit.kind)).toEqual(["opencode", "status"]);

    const mixedNonePlan = await planInitInstaller({
      cwd: tempDir,
      selections: {
        scope: "project",
        statusUi: ["none", "toast", "sidebar"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });
    expect(mixedNonePlan.selections.statusUi).toEqual(["toast", "sidebar"]);
    expect(mixedNonePlan.summaryLines).toContain("Status UI: Toast + Sidebar");
  });

  it("normalizes legacy status UI strings defensively", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: "toast_sidebar",
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      } as any,
    });

    expect(plan.selections.statusUi).toEqual(["toast", "sidebar"]);
    expect(plan.edits.map((edit) => edit.kind)).toEqual(["opencode", "status", "tui"]);

    await applyInitInstallerPlan(plan);

    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(statusConfig.enableToast).toBe(true);
  });

  it("maps legacy compact session-prompt selection to plugin-owned compact config", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["toast", "sidebar"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
        tuiCompactStatus: "home_bottom_session_prompt",
      } as any,
    });

    expect(plan.warnings).not.toContain(
      "sessionPrompt wraps OpenCode's core prompt slot and may conflict with other prompt-slot integrations.",
    );
    expect(plan.summaryLines).toContain("Compact status mode: Home bottom + session prompt");

    await applyInitInstallerPlan(plan);

    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    const opencode = readJson(join(projectDir, "opencode.json"));
    expect(statusConfig.tuiCompactStatus.sessionPrompt).toBe(true);
    expect(opencode.experimental).toBeUndefined();
  });

  it("updates installer-owned compact config values and preserves custom fields", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(join(projectDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(projectDir, "status-provider", "config.json"),
      JSON.stringify({
        enableToast: false,
        enabledProviders: "auto",
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
        tuiSidebarPanel: {
          enabled: false,
        },
        tuiCompactStatus: {
          enabled: false,
          sessionPrompt: false,
          maxWidth: 40,
        },
      }),
      "utf8",
    );

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["toast", "sidebar", "compact_status"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });

    const statusEdit = plan.edits.find((edit) => edit.kind === "status");
    expect(statusEdit?.addedKeys).toEqual(
      expect.arrayContaining([
        "statusProvider.tuiCompactStatus.homeBottom",
        "statusProvider.tuiCompactStatus.suppressWhenNativeProviderStatus",
      ]),
    );
    expect(statusEdit?.updatedKeys).toEqual(
      expect.arrayContaining([
        "statusProvider.enableToast",
        "statusProvider.tuiSidebarPanel.enabled",
        "statusProvider.tuiCompactStatus.enabled",
        "statusProvider.tuiCompactStatus.sessionPrompt",
      ]),
    );
    expect(statusEdit?.skippedValues).not.toEqual(
      expect.arrayContaining([
        "statusProvider.enableToast preserved existing value",
        "statusProvider.tuiSidebarPanel.enabled preserved existing value",
        "statusProvider.tuiCompactStatus.enabled preserved existing value",
        "statusProvider.tuiCompactStatus.sessionPrompt preserved existing value",
      ]),
    );

    await applyInitInstallerPlan(plan);

    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(statusConfig.enableToast).toBe(true);
    expect(statusConfig.tuiSidebarPanel).toEqual({ enabled: true });
    expect(statusConfig.tuiCompactStatus).toEqual({
      enabled: true,
      sessionPrompt: true,
      maxWidth: 40,
      homeBottom: true,
      suppressWhenNativeProviderStatus: true,
    });
  });

  it("disables deselected existing UI surfaces without adding compact safety fields", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(join(projectDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(projectDir, "status-provider", "config.json"),
      JSON.stringify({
        enableToast: true,
        enabledProviders: "auto",
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
        tuiSidebarPanel: {
          enabled: true,
        },
        tuiCompactStatus: {
          enabled: true,
          sessionPrompt: true,
        },
      }),
      "utf8",
    );

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["none"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });

    const statusEdit = plan.edits.find((edit) => edit.kind === "status");
    expect(statusEdit?.addedKeys).not.toEqual(
      expect.arrayContaining([
        "statusProvider.tuiCompactStatus.homeBottom",
        "statusProvider.tuiCompactStatus.suppressWhenNativeProviderStatus",
      ]),
    );
    expect(statusEdit?.updatedKeys).toEqual(
      expect.arrayContaining([
        "statusProvider.enableToast",
        "statusProvider.tuiSidebarPanel.enabled",
        "statusProvider.tuiCompactStatus.enabled",
      ]),
    );

    await applyInitInstallerPlan(plan);

    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(statusConfig.enableToast).toBe(false);
    expect(statusConfig.tuiSidebarPanel).toEqual({ enabled: false });
    expect(statusConfig.tuiCompactStatus).toEqual({
      enabled: false,
      sessionPrompt: true,
    });
  });

  it("tolerates legacy compact status without adding sidebar intent", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["toast"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
        tuiCompactStatus: "home_bottom",
      } as any,
    });

    expect(plan.selections.statusUi).toEqual(["toast", "compact_status"]);
    expect(plan.edits.map((edit) => edit.kind)).toEqual(["opencode", "status", "tui"]);
  });

  it("prompts for status UI as a multiselect and does not ask a separate compact status question", async () => {
    const prompts = createPromptStub({
      selectValues: ["project", "auto", "singleWindow", "remaining", "yes"],
      multiselectValues: [["sidebar", "compact_status"]],
      confirmValues: [true],
    });

    const code = await runInitInstaller({
      cwd: tempDir,
      prompts: prompts as any,
    });

    expect(code).toBe(0);
    expect(prompts.outroCalls).toContain(
      "Status init complete — if this helps, stars are appreciated: https://github.com/MrDyslexia/status-provider",
    );
    expect(prompts.multiselectCalls[0]).toMatchObject({
      message: "Status UI",
      required: true,
    });
    expect(prompts.multiselectCalls[0]?.options).toEqual([
      { label: "Toast", value: "toast", hint: "popup status summaries after idle/question/compact events" },
      { label: "Sidebar panel", value: "sidebar", hint: "full Status panel in the OpenCode session sidebar" },
      { label: "Compact status line", value: "compact_status", hint: "short status summary in the TUI status area" },
      { label: "Terminal/slash commands only", value: "none", hint: "no toast, sidebar, or compact status UI" },
    ]);
    const sessionTokenCall = prompts.selectCalls.find((call) => call.message === "Session token details");
    expect(sessionTokenCall?.options).toEqual([
      { label: "Hide session tokens", value: "no", hint: "keep status output shorter" },
      { label: "Show session tokens", value: "yes", hint: "include current session input/output token counts when available" },
    ]);
    const messages = prompts.selectCalls.map((call) => call.message);
    expect(messages).not.toContain("Compact TUI status");
    const statusConfig = readJson(join(tempDir, "status-provider", "config.json"));
    expect(statusConfig.tuiSidebarPanel).toEqual({ enabled: true });
    expect(statusConfig.tuiCompactStatus).toMatchObject({
      enabled: true,
      homeBottom: true,
      sessionPrompt: true,
      suppressWhenNativeProviderStatus: true,
    });
  });

  it("creates both opencode and tui targets for toast + sidebar mode with popup toasts enabled", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["toast", "sidebar"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });

    expect(plan.summaryLines).toContain("Status UI: Toast + Sidebar");
    expect(plan.summaryLines).toContain("Status reset periods: Single window");
    expect(plan.summaryLines).toContain("Status percentage meaning: Remaining");
    expect(plan.edits.map((edit) => edit.kind)).toEqual(["opencode", "status", "tui"]);

    await applyInitInstallerPlan(plan);

    const opencode = readJson(join(projectDir, "opencode.json"));
    const tui = readJson(join(projectDir, "tui.json"));

    expect(opencode.plugin).toEqual(["status-provider"]);
    expect(opencode.experimental).toBeUndefined();
    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(statusConfig).toMatchObject({
      enableToast: true,
      enabledProviders: "auto",
      formatStyle: "singleWindow",
      percentDisplayMode: "remaining",
      showSessionTokens: true,
      tuiSidebarPanel: { enabled: true },
    });
    expect(tui).toEqual({
      $schema: "https://opencode.ai/tui.json",
      plugin: ["status-provider"],
    });
  });

  it("does not touch tui config for none mode and disables popup toasts when missing", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    const plan = await planInitInstaller({
      cwd: projectDir,
      selections: {
        scope: "project",
        statusUi: ["none"],
        providerMode: "auto",
        manualProviders: [],
        formatStyle: "singleWindow",
        percentDisplayMode: "remaining",
        showSessionTokens: true,
      },
    });

    expect(plan.edits.map((edit) => edit.kind)).toEqual(["opencode", "status"]);

    await applyInitInstallerPlan(plan);

    expect(existsSync(join(projectDir, "tui.json"))).toBe(false);
    const opencode = readJson(join(projectDir, "opencode.json"));
    expect(opencode.experimental).toBeUndefined();
    const statusConfig = readJson(join(projectDir, "status-provider", "config.json"));
    expect(statusConfig.enableToast).toBe(false);
    expect(statusConfig.tuiSidebarPanel).toEqual({ enabled: false });
  });

  it("returns zero when the user cancels before applying changes", async () => {
    const prompts = createPromptStub({
      selectValues: ["project", "auto", "singleWindow", "remaining", "yes"],
      multiselectValues: [["toast"]],
      confirmValues: [false],
    });

    const code = await runInitInstaller({
      cwd: tempDir,
      prompts: prompts as any,
    });

    expect(code).toBe(0);
    expect(existsSync(join(tempDir, "opencode.json"))).toBe(false);
  });

  it("returns one when planning fails after prompt collection", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "opencode.json"),
      JSON.stringify({
        plugin: {
          bad: true,
        },
      }),
      "utf8",
    );

    const logError = vi.fn();
    const prompts = createPromptStub({
      selectValues: ["project", "auto", "singleWindow", "remaining", "yes"],
      multiselectValues: [["toast"]],
    });
    prompts.log.error = logError;

    const code = await runInitInstaller({
      cwd: projectDir,
      prompts: prompts as any,
    });

    expect(code).toBe(1);
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/plugin is not an array/i));
  });

  it("fails when an existing plugin container is not an array", async () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "opencode.json"),
      JSON.stringify({
        plugin: {
          bad: true,
        },
      }),
      "utf8",
    );

    await expect(
      planInitInstaller({
        cwd: projectDir,
        selections: {
          scope: "project",
          statusUi: ["toast"],
          providerMode: "auto",
          manualProviders: [],
          formatStyle: "singleWindow",
          percentDisplayMode: "remaining",
          showSessionTokens: true,
        },
      }),
    ).rejects.toThrow(/plugin is not an array/i);
  });
});
