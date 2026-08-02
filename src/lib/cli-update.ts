import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { writeJsonAtomic } from "./atomic-json.js";
import {
  findGitWorktreeRoot,
  getConfigFileCandidatePaths,
  getPluginSpecFromEntry,
  isStatusNpmPluginSpec,
  isStatusPluginSpec,
  type ConfigFileKind,
} from "./config-file-utils.js";
import { parseJsonOrJsonc } from "./jsonc.js";
import { getOpencodeRuntimeDirCandidates } from "./opencode-runtime-paths.js";
import { getPackageVersion } from "./version.js";

const PACKAGE_NAME = "status-provider";
const DEFAULT_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export type UpdateScope = "project" | "global";

export interface CliUpdateEdit {
  scope: UpdateScope;
  path: string;
  changed: boolean;
  matchedSpecs: string[];
  skippedLocalSpecs: string[];
  nextData: unknown;
}

export interface CliUpdatePlan {
  version: string;
  targetSpec: string;
  edits: CliUpdateEdit[];
}

export interface RunCliUpdateCommandOptions {
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  fetchLatestVersion?: () => Promise<string>;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseVersion(value: string): string {
  const version = value.trim().replace(/^v/, "");
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid status-provider version: ${value}`);
  }
  return version;
}

export async function fetchLatestStatusProviderVersion(params?: {
  fetch?: typeof globalThis.fetch;
  registryUrl?: string;
}): Promise<string> {
  const fetchImpl = params?.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetchImpl(params?.registryUrl ?? DEFAULT_REGISTRY_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`npm registry returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { version?: unknown };
    if (typeof payload.version !== "string") {
      throw new Error("npm registry response did not include a version");
    }
    return parseVersion(payload.version);
  } finally {
    clearTimeout(timeout);
  }
}

function resolveGlobalConfigDir(params: { env: NodeJS.ProcessEnv; homeDir: string }): string {
  const explicit = params.env.OPENCODE_CONFIG_DIR?.trim();
  if (explicit) {
    return isAbsolute(explicit) ? explicit : resolve(params.homeDir, explicit);
  }
  return getOpencodeRuntimeDirCandidates({
    env: params.env,
    homeDir: params.homeDir,
  }).configDirs[0]!;
}

function resolveScopeDirs(params: {
  scopes: UpdateScope[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
}): Array<{ scope: UpdateScope; dir: string }> {
  return params.scopes.map((scope) => ({
    scope,
    dir:
      scope === "global"
        ? resolveGlobalConfigDir(params)
        : (findGitWorktreeRoot(params.cwd) ?? params.cwd),
  }));
}

function updatePluginEntry(
  entry: unknown,
  targetSpec: string,
): {
  entry: unknown;
  matchedSpec?: string;
  skippedLocalSpec?: string;
  changed: boolean;
} {
  const spec = getPluginSpecFromEntry(entry);
  if (!spec) return { entry, changed: false };
  if (isStatusNpmPluginSpec(spec)) {
    if (spec === targetSpec) return { entry, matchedSpec: spec, changed: false };
    if (typeof entry === "string") {
      return { entry: targetSpec, matchedSpec: spec, changed: true };
    }
    if (!Array.isArray(entry)) return { entry, matchedSpec: spec, changed: false };
    const next = [...entry];
    next[0] = targetSpec;
    return { entry: next, matchedSpec: spec, changed: true };
  }
  if (isStatusPluginSpec(spec, "opencode") || isStatusPluginSpec(spec, "tui")) {
    return { entry, skippedLocalSpec: spec, changed: false };
  }
  return { entry, changed: false };
}

function updatePluginList(params: { list: unknown; targetSpec: string }): {
  list: unknown;
  changed: boolean;
  matchedSpecs: string[];
  skippedLocalSpecs: string[];
} {
  if (!Array.isArray(params.list)) {
    return { list: params.list, changed: false, matchedSpecs: [], skippedLocalSpecs: [] };
  }

  let changed = false;
  const matchedSpecs: string[] = [];
  const skippedLocalSpecs: string[] = [];
  const list = params.list.map((entry) => {
    const result = updatePluginEntry(entry, params.targetSpec);
    changed ||= result.changed;
    if (result.matchedSpec) matchedSpecs.push(result.matchedSpec);
    if (result.skippedLocalSpec) skippedLocalSpecs.push(result.skippedLocalSpec);
    return result.entry;
  });

  return { list, changed, matchedSpecs, skippedLocalSpecs };
}

function updateParsedConfig(params: {
  parsed: unknown;
  kind: ConfigFileKind;
  targetSpec: string;
}): {
  nextData: unknown;
  changed: boolean;
  matchedSpecs: string[];
  skippedLocalSpecs: string[];
} {
  if (!isJsonObject(params.parsed)) {
    throw new Error("OpenCode config root must be an object");
  }

  let changed = false;
  const matchedSpecs: string[] = [];
  const skippedLocalSpecs: string[] = [];

  const rootResult = updatePluginList({
    list: params.parsed.plugin,
    targetSpec: params.targetSpec,
  });
  if (rootResult.changed) params.parsed.plugin = rootResult.list;
  changed ||= rootResult.changed;
  matchedSpecs.push(...rootResult.matchedSpecs);
  skippedLocalSpecs.push(...rootResult.skippedLocalSpecs);

  if (isJsonObject(params.parsed.tui)) {
    const tuiResult = updatePluginList({
      list: params.parsed.tui.plugin,
      targetSpec: params.targetSpec,
    });
    if (tuiResult.changed) params.parsed.tui.plugin = tuiResult.list;
    changed ||= tuiResult.changed;
    matchedSpecs.push(...tuiResult.matchedSpecs);
    skippedLocalSpecs.push(...tuiResult.skippedLocalSpecs);
  }

  return { nextData: params.parsed, changed, matchedSpecs, skippedLocalSpecs };
}

export async function planCliUpdate(params: {
  version: string;
  scopes?: UpdateScope[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): Promise<CliUpdatePlan> {
  const version = parseVersion(params.version);
  const targetSpec = `${PACKAGE_NAME}@${version}`;
  const cwd = resolve(params.cwd ?? process.cwd());
  const env = params.env ?? process.env;
  const homeDir = params.homeDir ?? homedir();
  const scopes = params.scopes ?? ["project", "global"];
  const edits: CliUpdateEdit[] = [];
  const seen = new Set<string>();

  for (const target of resolveScopeDirs({ scopes, cwd, env, homeDir })) {
    for (const kind of ["opencode", "tui"] as const) {
      for (const path of getConfigFileCandidatePaths(target.dir, kind)) {
        if (!existsSync(path) || seen.has(path)) continue;
        seen.add(path);
        const raw = await readFile(path, "utf8");
        const parsed = parseJsonOrJsonc(raw, path.endsWith(".jsonc"));
        const result = updateParsedConfig({ parsed, kind, targetSpec });
        if (result.matchedSpecs.length === 0 && result.skippedLocalSpecs.length === 0) continue;
        edits.push({ scope: target.scope, path, ...result });
      }
    }
  }

  return { version, targetSpec, edits };
}

export async function applyCliUpdatePlan(plan: CliUpdatePlan): Promise<string[]> {
  const written: string[] = [];
  for (const edit of plan.edits) {
    if (!edit.changed) continue;
    await writeJsonAtomic(edit.path, edit.nextData, { trailingNewline: true });
    written.push(edit.path);
  }
  return written;
}

function parseArgs(argv: string[]): {
  scopes: UpdateScope[];
  dryRun: boolean;
  version?: string;
} {
  let dryRun = false;
  let version: string | undefined;
  let scope: UpdateScope | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--dry-run" || arg === "-n") {
      dryRun = true;
      continue;
    }
    if (arg === "--global" || arg === "-g") {
      if (scope === "project") throw new Error("Use only one of --global or --project");
      scope = "global";
      continue;
    }
    if (arg === "--project" || arg === "-p") {
      if (scope === "global") throw new Error("Use only one of --global or --project");
      scope = "project";
      continue;
    }
    if (arg === "--version") {
      const value = argv[index + 1];
      if (!value) throw new Error("--version requires a value");
      version = parseVersion(value);
      index++;
      continue;
    }
    throw new Error(`Unknown update argument: ${arg}`);
  }

  return { scopes: scope ? [scope] : ["project", "global"], dryRun, version };
}

export async function runCliUpdateCommand(
  options: RunCliUpdateCommandOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const args = parseArgs(options.argv ?? process.argv.slice(3));
    const version =
      args.version ?? (await (options.fetchLatestVersion ?? fetchLatestStatusProviderVersion)());
    const plan = await planCliUpdate({
      version,
      scopes: args.scopes,
      cwd: options.cwd,
      env: options.env,
      homeDir: options.homeDir,
    });
    const currentVersion = (await getPackageVersion()) ?? "unknown";

    stdout.write(`status-provider ${currentVersion} -> ${plan.version}\n`);
    if (plan.edits.length === 0) {
      stderr.write(
        "No npm-based status-provider plugin config found. Run status-provider init first.\n",
      );
      return 1;
    }

    const hasNpmConfig = plan.edits.some((edit) => edit.matchedSpecs.length > 0);
    if (!hasNpmConfig) {
      for (const edit of plan.edits) {
        for (const spec of edit.skippedLocalSpecs) {
          stdout.write(`skip local plugin: ${spec}\n`);
        }
      }
      stderr.write(
        "No npm-based status-provider plugin config found. Local file plugins are not replaced.\n",
      );
      return 1;
    }

    for (const edit of plan.edits) {
      const action = edit.changed ? (args.dryRun ? "would update" : "update") : "already pinned";
      stdout.write(`${action}: ${edit.path}\n`);
      for (const spec of edit.skippedLocalSpecs) {
        stdout.write(`skip local plugin: ${spec}\n`);
      }
    }

    if (args.dryRun) {
      stdout.write("Dry run: no files changed.\n");
      return 0;
    }

    const written = await applyCliUpdatePlan(plan);
    if (written.length === 0) {
      stdout.write(`Already configured for ${plan.targetSpec}.\n`);
      return 0;
    }

    stdout.write("Restart OpenCode to install and load the updated plugin.\n");
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`status-provider update failed: ${message}\n`);
    return 1;
  }
}
