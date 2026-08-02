import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyCliUpdatePlan,
  fetchLatestStatusProviderVersion,
  planCliUpdate,
  runCliUpdateCommand,
} from "../src/lib/cli-update.js";
import { parseJsonOrJsonc } from "../src/lib/jsonc.js";

function readJson(path: string): any {
  return parseJsonOrJsonc(readFileSync(path, "utf8"), path.endsWith(".jsonc"));
}

function outputBuffer(): { stream: { write: (chunk: string) => boolean }; text: () => string } {
  let value = "";
  return {
    stream: {
      write(chunk: string) {
        value += chunk;
        return true;
      },
    },
    text: () => value,
  };
}

describe("status-provider update", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("pins project server and TUI plugin specs while preserving tuple options", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "status-provider-update-"));
    const project = join(tempDir, "project");
    const nested = join(project, "packages", "app");
    mkdirSync(join(project, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(project, "opencode.json"),
      JSON.stringify({ plugin: ["other-plugin", "status-provider"] }),
      "utf8",
    );
    writeFileSync(
      join(project, "tui.json"),
      JSON.stringify({ plugin: [["status-provider@0.1.0", { compact: true }]] }),
      "utf8",
    );

    const plan = await planCliUpdate({
      version: "0.2.0",
      scopes: ["project"],
      cwd: nested,
    });

    expect(plan.targetSpec).toBe("status-provider@0.2.0");
    expect(plan.edits).toHaveLength(2);
    expect(await applyCliUpdatePlan(plan)).toEqual([
      join(project, "opencode.json"),
      join(project, "tui.json"),
    ]);
    expect(readJson(join(project, "opencode.json")).plugin).toEqual([
      "other-plugin",
      "status-provider@0.2.0",
    ]);
    expect(readJson(join(project, "tui.json")).plugin).toEqual([
      ["status-provider@0.2.0", { compact: true }],
    ]);
  });

  it("updates global config under XDG_CONFIG_HOME", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "status-provider-update-global-"));
    const configDir = join(tempDir, "xdg", "opencode");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "opencode.json"),
      JSON.stringify({ plugin: ["status-provider"] }),
      "utf8",
    );

    const plan = await planCliUpdate({
      version: "0.2.0",
      scopes: ["global"],
      env: { XDG_CONFIG_HOME: join(tempDir, "xdg") },
      homeDir: tempDir,
    });
    await applyCliUpdatePlan(plan);

    expect(readJson(join(configDir, "opencode.json")).plugin).toEqual(["status-provider@0.2.0"]);
  });

  it("preserves JSONC comments", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "status-provider-update-jsonc-"));
    const project = join(tempDir, "project");
    mkdirSync(join(project, ".git"), { recursive: true });
    writeFileSync(
      join(project, "opencode.jsonc"),
      `{
        // keep this comment
        "plugin": ["status-provider"],
      }`,
      "utf8",
    );

    const plan = await planCliUpdate({
      version: "0.2.0",
      scopes: ["project"],
      cwd: project,
    });
    await applyCliUpdatePlan(plan);

    const output = readFileSync(join(project, "opencode.jsonc"), "utf8");
    expect(output).toContain("// keep this comment");
    expect(output).toContain('"status-provider@0.2.0"');
  });

  it("does not replace local development plugins", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "status-provider-update-local-"));
    const project = join(tempDir, "project");
    mkdirSync(join(project, ".git"), { recursive: true });
    const path = join(project, "opencode.json");
    const localSpec = "file:///workspace/status-provider/dist/index.js";
    writeFileSync(path, JSON.stringify({ plugin: [localSpec] }), "utf8");
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    const code = await runCliUpdateCommand({
      argv: ["--project", "--version", "0.2.0"],
      cwd: project,
      stdout: stdout.stream as any,
      stderr: stderr.stream as any,
    });

    expect(code).toBe(1);
    expect(stdout.text()).toContain(`skip local plugin: ${localSpec}`);
    expect(stderr.text()).toContain("Local file plugins are not replaced");
    expect(readJson(path).plugin).toEqual([localSpec]);
  });

  it("supports a dry run without writing files", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "status-provider-update-dry-"));
    const project = join(tempDir, "project");
    mkdirSync(join(project, ".git"), { recursive: true });
    const path = join(project, "opencode.json");
    writeFileSync(path, JSON.stringify({ plugin: ["status-provider"] }), "utf8");
    const stdout = outputBuffer();
    const fetchLatestVersion = vi.fn().mockResolvedValue("0.2.0");

    const code = await runCliUpdateCommand({
      argv: ["--project", "--dry-run"],
      cwd: project,
      stdout: stdout.stream as any,
      stderr: outputBuffer().stream as any,
      fetchLatestVersion,
    });

    expect(code).toBe(0);
    expect(fetchLatestVersion).toHaveBeenCalledOnce();
    expect(stdout.text()).toContain(`would update: ${path}`);
    expect(stdout.text()).toContain("Dry run: no files changed");
    expect(readJson(path).plugin).toEqual(["status-provider"]);
  });

  it("returns an error when no npm plugin config exists", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "status-provider-update-empty-"));
    const project = join(tempDir, "project");
    mkdirSync(join(project, ".git"), { recursive: true });
    const stderr = outputBuffer();

    const code = await runCliUpdateCommand({
      argv: ["--project", "--version", "0.2.0"],
      cwd: project,
      stdout: outputBuffer().stream as any,
      stderr: stderr.stream as any,
    });

    expect(code).toBe(1);
    expect(stderr.text()).toContain("Run status-provider init first");
    expect(existsSync(join(project, "opencode.json"))).toBe(false);
  });

  it("reads and validates the npm latest version response", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: "0.2.0" }),
    });

    await expect(fetchLatestStatusProviderVersion({ fetch: fetch as any })).resolves.toBe("0.2.0");
    expect(fetch).toHaveBeenCalledWith(
      "https://registry.npmjs.org/status-provider/latest",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
