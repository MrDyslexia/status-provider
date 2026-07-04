import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const mockedHomeDir = vi.hoisted(() => ({
  value: "",
}));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: () => mockedHomeDir.value || actual.homedir(),
  };
});

import {
  createStatusProviderRuntimeContext,
  resolveStatusRuntimeContext,
  type StatusRuntimeClient,
} from "../src/lib/status-runtime-context.js";
import { resolveRuntimeContextRoots } from "../src/lib/config-file-utils.js";
import { createLoadConfigMeta } from "../src/lib/config.js";
import { DEFAULT_CONFIG } from "../src/lib/types.js";

function statusConfigSource(dir: string): string {
  return join(dir, "status-provider", "config.json") + " (status-provider/config.json)";
}

function writeStatusConfig(dir: string, config: Record<string, unknown>): void {
  mkdirSync(join(dir, "status-provider"), { recursive: true });
  writeFileSync(join(dir, "status-provider", "config.json"), JSON.stringify(config), "utf8");
}

describe("status runtime context", () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd();

  let tempDir: string;
  let worktreeDir: string;
  let nestedDir: string;
  let xdgConfigHome: string;

  beforeEach(() => {
    delete process.env.OPENCODE_CONFIG_DIR;
    tempDir = mkdtempSync(join(tmpdir(), "status-provider-runtime-context-"));
    mockedHomeDir.value = tempDir;
    worktreeDir = join(tempDir, "worktree");
    nestedDir = join(worktreeDir, "packages", "feature");
    xdgConfigHome = join(tempDir, "xdg-config");

    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(join(xdgConfigHome, "opencode"), { recursive: true });

    process.env = {
      ...originalEnv,
      HOME: tempDir,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: join(tempDir, "xdg-data"),
      XDG_CACHE_HOME: join(tempDir, "xdg-cache"),
      XDG_STATE_HOME: join(tempDir, "xdg-state"),
      APPDATA: join(tempDir, "appdata", "roaming"),
      LOCALAPPDATA: join(tempDir, "appdata", "local"),
    };
    process.chdir(nestedDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    mockedHomeDir.value = "";
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createClient(): StatusRuntimeClient {
    return {
      config: {
        get: vi.fn().mockResolvedValue({ data: {} }),
        providers: vi.fn().mockResolvedValue({ data: { providers: [{ id: "copilot" }] } }),
      },
    } as unknown as StatusRuntimeClient;
  }

  it("keeps workspace-root and config-root selection separate", () => {
    expect(
      resolveRuntimeContextRoots({
        worktreeRoot: worktreeDir,
        activeDirectory: nestedDir,
        configRoot: nestedDir,
        fallbackDirectory: nestedDir,
      }),
    ).toEqual({
      workspaceRoot: worktreeDir,
      configRoot: nestedDir,
    });
  });

  it("loads config from the resolved shared config root", async () => {
    writeStatusConfig(worktreeDir, { enabled: false });

    writeStatusConfig(nestedDir, { enabled: true });

    const runtime = await resolveStatusRuntimeContext({
      client: createClient(),
      roots: {
        worktreeRoot: worktreeDir,
        activeDirectory: nestedDir,
        fallbackDirectory: nestedDir,
      },
      providers: [],
    });

    const worktreeConfigPath = statusConfigSource(worktreeDir);
    const nestedConfigPath = statusConfigSource(nestedDir);

    expect(runtime.roots).toEqual({
      workspaceRoot: worktreeDir,
      configRoot: worktreeDir,
    });
    expect(runtime.config.enabled).toBe(false);
    expect(runtime.configMeta.source).toBe("files");
    expect(runtime.configMeta.paths).toContain(worktreeConfigPath);
    expect(runtime.configMeta.paths).not.toContain(nestedConfigPath);
    expect(runtime.configMeta.globalConfigPaths).toEqual([]);
    expect(runtime.configMeta.workspaceConfigPaths).toEqual([worktreeConfigPath]);
    expect(runtime.configMeta.settingSources.enabled).toBe(worktreeConfigPath);
  });

  it("does not re-resolve OPENCODE_CONFIG_DIR when loadConfig receives resolved configRootDir", async () => {
    process.env.OPENCODE_CONFIG_DIR = ".opencode";
    mkdirSync(join(worktreeDir, ".opencode", ".opencode"), { recursive: true });
    writeStatusConfig(join(worktreeDir, ".opencode"), { enabled: false });
    writeStatusConfig(join(worktreeDir, ".opencode", ".opencode"), { enabled: true });

    const runtime = await resolveStatusRuntimeContext({
      client: createClient(),
      roots: {
        worktreeRoot: worktreeDir,
        activeDirectory: nestedDir,
        fallbackDirectory: nestedDir,
      },
      providers: [],
    });

    expect(runtime.roots).toEqual({
      workspaceRoot: worktreeDir,
      configRoot: join(worktreeDir, ".opencode"),
    });
    expect(runtime.config.enabled).toBe(false);
    expect(runtime.configMeta.paths).toContain(statusConfigSource(join(worktreeDir, ".opencode")));
    expect(runtime.configMeta.paths).not.toContain(
      statusConfigSource(join(worktreeDir, ".opencode", ".opencode")),
    );
  });

  it("propagates request timeout config and explicit-source state to provider context", () => {
    const configMeta = createLoadConfigMeta();
    configMeta.settingSources.requestTimeoutMs = "test config";

    const providerContext = createStatusProviderRuntimeContext({
      client: createClient(),
      config: {
        ...DEFAULT_CONFIG,
        requestTimeoutMs: 12000,
      },
      configMeta,
      session: {},
    });

    expect(providerContext.config?.requestTimeoutMs).toBe(12000);
    expect(providerContext.config?.requestTimeoutMsConfigured).toBe(true);
  });

  it("copies default request timeout without marking it explicitly configured", () => {
    const providerContext = createStatusProviderRuntimeContext({
      client: createClient(),
      config: DEFAULT_CONFIG,
      session: {},
    });

    expect(providerContext.config?.requestTimeoutMs).toBe(DEFAULT_CONFIG.requestTimeoutMs);
    expect(providerContext.config?.requestTimeoutMsConfigured).toBe(false);
  });

  it("resolves session meta only when the shared config requests it", async () => {
    writeStatusConfig(nestedDir, { enabled: true, onlyCurrentModel: true });

    const resolveSessionMeta = vi.fn().mockResolvedValue({
      providerID: "copilot",
      modelID: "gpt-4.1",
    });

    const runtime = await resolveStatusRuntimeContext({
      client: createClient(),
      roots: {
        workspaceRoot: worktreeDir,
        configRoot: nestedDir,
        activeDirectory: nestedDir,
        fallbackDirectory: nestedDir,
      },
      sessionID: "session-1",
      resolveSessionMeta,
      includeSessionMeta: (config) => config.onlyCurrentModel,
      providers: [],
    });

    expect(resolveSessionMeta).toHaveBeenCalledWith("session-1");
    expect(runtime.roots).toEqual({
      workspaceRoot: worktreeDir,
      configRoot: nestedDir,
    });
    expect(runtime.session.sessionMeta).toEqual({
      providerID: "copilot",
      modelID: "gpt-4.1",
    });
  });
});
