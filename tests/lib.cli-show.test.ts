import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockProviders, runtimeDirs } = vi.hoisted(() => ({
  mockProviders: [] as any[],
  runtimeDirs: {
    value: {
      dataDirs: [] as string[],
      configDirs: [] as string[],
      cacheDirs: [] as string[],
      stateDirs: [] as string[],
    },
  },
}));

vi.mock("../src/providers/registry.js", () => ({
  getProviders: () => mockProviders,
  getOrderedProviders: (config: { enabledProviders: unknown }) => {
    if (!config || config.enabledProviders === "auto") return mockProviders;
    const enabled = new Set(
      Array.isArray(config.enabledProviders) ? config.enabledProviders : [],
    );
    return mockProviders.filter((p: { id: string }) => enabled.has(p.id));
  },
}));

vi.mock("../src/lib/opencode-runtime-paths.js", () => ({
  getOpencodeRuntimeDirCandidates: () => runtimeDirs.value,
  getOpencodeRuntimeDirs: () => ({
    dataDir: runtimeDirs.value.dataDirs[0] ?? "/tmp/status-provider-cli-show-data",
    configDir: runtimeDirs.value.configDirs[0] ?? "/tmp/status-provider-cli-show-config",
    cacheDir: runtimeDirs.value.cacheDirs[0] ?? "/tmp/status-provider-cli-show-cache",
    stateDir: runtimeDirs.value.stateDirs[0] ?? "/tmp/status-provider-cli-show-state",
  }),
}));

import { runCliShowCommand } from "../src/lib/cli-show.js";
import { __resetStatusStateForTests } from "../src/lib/status-state.js";

function createCaptureStream() {
  let output = "";
  return {
    stream: {
      write: (chunk: string | Uint8Array) => {
        output += String(chunk);
        return true;
      },
    },
    get output() {
      return output;
    },
  };
}

describe("runCliShowCommand", () => {
  let tempDir: string;
  let globalConfigDir: string;
  let workspaceDir: string;
  let savedConfigDir: string | undefined;

  beforeEach(() => {
    savedConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    tempDir = mkdtempSync(join(tmpdir(), "status-provider-cli-show-"));
    globalConfigDir = join(tempDir, "global-config", "opencode");
    workspaceDir = join(tempDir, "workspace");
    mkdirSync(globalConfigDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
    runtimeDirs.value = {
      dataDirs: [],
      configDirs: [globalConfigDir],
      cacheDirs: [join(tempDir, "cache")],
      stateDirs: [],
    };
    mockProviders.length = 0;
    __resetStatusStateForTests();
  });

  afterEach(() => {
    if (savedConfigDir !== undefined) process.env.OPENCODE_CONFIG_DIR = savedConfigDir;
    else delete process.env.OPENCODE_CONFIG_DIR;
    mockProviders.length = 0;
    __resetStatusStateForTests();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("renders a compact status glance and returns zero when status rows are available", async () => {
    const provider = {
      id: "synthetic",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ name: "Synthetic Weekly", percentRemaining: 75 }],
        errors: [],
      }),
    };
    mockProviders.push(provider);
    mkdirSync(join(workspaceDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(workspaceDir, "status-provider", "config.json"),
      JSON.stringify({ enabledProviders: ["synthetic"], showSessionTokens: true }),
      "utf8",
    );

    const stdout = createCaptureStream();
    const stderr = createCaptureStream();

    const code = await runCliShowCommand({
      argv: [],
      cwd: workspaceDir,
      stdout: stdout.stream as any,
      stderr: stderr.stream as any,
    });

    expect(code).toBe(0);
    expect(stdout.output).toContain("Synthetic Weekly");
    expect(stdout.output).toContain("75%");
    expect(stderr.output).toBe("");
    expect(provider.fetch).toHaveBeenCalledOnce();
  });

  it("normalizes --provider aliases and uses the provider as an invocation override", async () => {
    const copilotProvider = {
      id: "copilot",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ name: "Copilot", percentRemaining: 50 }],
        errors: [],
      }),
    };
    const openAiProvider = {
      id: "openai",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({ attempted: true, entries: [], errors: [] }),
    };
    mockProviders.push(openAiProvider, copilotProvider);
    // No sidecar config — auto-detect mode so CLI --provider override can select copilot

    const stdout = createCaptureStream();
    const stderr = createCaptureStream();

    const code = await runCliShowCommand({
      argv: ["--provider=github-copilot"],
      cwd: workspaceDir,
      stdout: stdout.stream as any,
      stderr: stderr.stream as any,
    });

    expect(code).toBe(0);
    expect(stdout.output).toContain("Copilot");
    expect(copilotProvider.fetch).toHaveBeenCalledOnce();
    expect(openAiProvider.fetch).not.toHaveBeenCalled();
    expect(stderr.output).toBe("");
  });

  it("rejects an unknown provider before probing providers", async () => {
    const provider = {
      id: "copilot",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn(),
    };
    mockProviders.push(provider);
    const stdout = createCaptureStream();
    const stderr = createCaptureStream();

    const code = await runCliShowCommand({
      argv: ["--provider", "not-a-provider"],
      cwd: workspaceDir,
      stdout: stdout.stream as any,
      stderr: stderr.stream as any,
    });

    expect(code).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain("Unknown provider: not-a-provider");
    expect(provider.isAvailable).not.toHaveBeenCalled();
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it("rejects missing provider values", async () => {
    const stdout = createCaptureStream();
    const stderr = createCaptureStream();

    const code = await runCliShowCommand({
      argv: ["--provider"],
      cwd: workspaceDir,
      stdout: stdout.stream as any,
      stderr: stderr.stream as any,
    });

    expect(code).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain("Missing value for --provider");
    expect(stderr.output).toContain("status-provider show");
  });

  it("returns non-zero when status is disabled in config", async () => {
    mkdirSync(join(workspaceDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(workspaceDir, "status-provider", "config.json"),
      JSON.stringify({ enabled: false }),
      "utf8",
    );
    const stdout = createCaptureStream();
    const stderr = createCaptureStream();

    const code = await runCliShowCommand({
      argv: [],
      cwd: workspaceDir,
      stdout: stdout.stream as any,
      stderr: stderr.stream as any,
    });

    expect(code).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain("Status disabled in config");
  });

  it("renders explicit unavailable provider output but returns non-zero", async () => {
    const provider = {
      id: "copilot",
      isAvailable: vi.fn().mockResolvedValue(false),
      fetch: vi.fn(),
    };
    mockProviders.push(provider);
    const stdout = createCaptureStream();
    const stderr = createCaptureStream();

    const code = await runCliShowCommand({
      argv: ["--provider", "copilot"],
      cwd: workspaceDir,
      stdout: stdout.stream as any,
      stderr: stderr.stream as any,
    });

    expect(code).toBe(1);
    expect(stdout.output).toContain("Copilot: Unavailable (not detected)");
    expect(stderr.output).toBe("");
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it("prefers the git worktree root over a nested cwd for config loading", async () => {
    const nestedDir = join(workspaceDir, "packages", "app");
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(join(workspaceDir, ".git"));
    mkdirSync(join(workspaceDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(workspaceDir, "status-provider", "config.json"),
      JSON.stringify({ enabled: false }),
      "utf8",
    );
    mkdirSync(join(nestedDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(nestedDir, "status-provider", "config.json"),
      JSON.stringify({ enabled: true }),
      "utf8",
    );
    const stdout = createCaptureStream();
    const stderr = createCaptureStream();

    const code = await runCliShowCommand({
      argv: [],
      cwd: nestedDir,
      stdout: stdout.stream as any,
      stderr: stderr.stream as any,
    });

    expect(code).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain("Status disabled in config");
  });

  it("resolves relative OPENCODE_CONFIG_DIR from the worktree root", async () => {
    const nestedDir = join(workspaceDir, "packages", "app");
    const provider = {
      id: "synthetic",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn(),
    };
    mockProviders.push(provider);
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(join(workspaceDir, ".git"));
    mkdirSync(join(workspaceDir, ".opencode", "status-provider"), { recursive: true });
    process.env.OPENCODE_CONFIG_DIR = ".opencode";
    writeFileSync(
      join(workspaceDir, ".opencode", "status-provider", "config.json"),
      JSON.stringify({ enabled: false }),
      "utf8",
    );
    const stdout = createCaptureStream();
    const stderr = createCaptureStream();

    const code = await runCliShowCommand({
      argv: [],
      cwd: nestedDir,
      stdout: stdout.stream as any,
      stderr: stderr.stream as any,
    });

    expect(code).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain("Status disabled in config");
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it("renders Copilot and Gemini CLI success rows in standalone show", async () => {
    const copilotProvider = {
      id: "copilot",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ name: "Copilot", group: "Copilot (personal)", label: "Status:", right: "0/300", percentRemaining: 100 }],
        errors: [],
      }),
    };
    const geminiCliProvider = {
      id: "google-gemini-cli",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ name: "Gemini Pro", group: "Gemini CLI", label: "Gemini Pro:", right: "840 left", percentRemaining: 84 }],
        errors: [],
      }),
    };
    mockProviders.push(copilotProvider, geminiCliProvider);
    mkdirSync(join(workspaceDir, "status-provider"), { recursive: true });
    writeFileSync(
      join(workspaceDir, "status-provider", "config.json"),
      JSON.stringify({ enabledProviders: ["copilot", "google-gemini-cli"], formatStyle: "allWindows" }),
      "utf8",
    );
    const stdout = createCaptureStream();
    const stderr = createCaptureStream();

    const code = await runCliShowCommand({
      argv: [],
      cwd: workspaceDir,
      stdout: stdout.stream as any,
      stderr: stderr.stream as any,
    });

    expect(code).toBe(0);
    expect(stdout.output).toContain("Copilot");
    expect(stdout.output).toContain("Gemini CLI");
    expect(copilotProvider.fetch).toHaveBeenCalledOnce();
    expect(geminiCliProvider.fetch).toHaveBeenCalledOnce();
    expect(stderr.output).toBe("");
  });

  it("uses root-level OpenCode provider ids for standalone provider availability", async () => {
    const provider = {
      id: "copilot",
      isAvailable: vi.fn(async (ctx: any) => {
        const response = await ctx.client.config.providers();
        return response.data.providers.some((item: { id: string }) => item.id === "github-copilot");
      }),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ name: "Copilot", percentRemaining: 88 }],
        errors: [],
      }),
    };
    mockProviders.push(provider);
    writeFileSync(
      join(workspaceDir, "opencode.json"),
      JSON.stringify({ provider: { "github-copilot": {} } }),
      "utf8",
    );
    const stdout = createCaptureStream();
    const stderr = createCaptureStream();

    const code = await runCliShowCommand({
      argv: [],
      cwd: workspaceDir,
      stdout: stdout.stream as any,
      stderr: stderr.stream as any,
    });

    expect(code).toBe(0);
    expect(stdout.output).toContain("Copilot");
    expect(provider.fetch).toHaveBeenCalledOnce();
    expect(stderr.output).toBe("");
  });
});
