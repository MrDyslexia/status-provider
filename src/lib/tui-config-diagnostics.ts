import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";

import {
  dedupeNonEmptyStrings,
  extractPluginSpecsFromParsedConfig,
  findGitWorktreeRoot,
  getConfigFileCandidatePaths,
  isStatusPluginSpec,
  resolveRuntimeContextRoots,
  type RuntimeContextRootHints,
  type RuntimeContextRoots,
} from "./config-file-utils.js";
import { parseJsonOrJsonc } from "./jsonc.js";
import { getOpencodeRuntimeDirCandidates } from "./opencode-runtime-paths.js";

export interface TuiConfigDiagnostics {
  workspaceRoot: string;
  configRoot: string;
  configured: boolean;
  inferredSelectedPath: string | null;
  presentPaths: string[];
  candidatePaths: string[];
  statusPluginConfigured: boolean;
  statusPluginConfigPaths: string[];
}

export interface InspectTuiConfigParams {
  cwd?: string;
  roots?: RuntimeContextRootHints | RuntimeContextRoots;
}

function resolveTuiConfigRoots(params?: InspectTuiConfigParams): RuntimeContextRoots {
  const cwd = params?.cwd ?? process.cwd();
  const providedRoots = params?.roots;
  if (providedRoots) {
    if ("fallbackDirectory" in providedRoots) {
      return resolveRuntimeContextRoots(providedRoots);
    }

    return {
      workspaceRoot: providedRoots.workspaceRoot,
      configRoot: providedRoots.configRoot,
    };
  }

  return resolveRuntimeContextRoots({
    worktreeRoot: findGitWorktreeRoot(cwd),
    activeDirectory: cwd,
    fallbackDirectory: cwd,
  });
}

function getTuiConfigCandidatePaths(roots: RuntimeContextRoots): string[] {
  const { configDirs } = getOpencodeRuntimeDirCandidates();
  const searchRoots = dedupeNonEmptyStrings([
    ...configDirs,
    roots.workspaceRoot,
    join(roots.workspaceRoot, ".opencode"),
    roots.configRoot,
    join(roots.configRoot, ".opencode"),
  ]);

  return searchRoots.flatMap((dir) => getConfigFileCandidatePaths(dir, "tui"));
}

async function readConfigJson(path: string): Promise<unknown | null> {
  try {
    const content = await readFile(path, "utf-8");
    return parseJsonOrJsonc(content, path.endsWith(".jsonc"));
  } catch {
    return null;
  }
}

async function findStatusPluginConfigPaths(paths: string[]): Promise<string[]> {
  const statusPluginConfigPaths: string[] = [];

  for (const path of paths) {
    const parsed = await readConfigJson(path);
    const specs = extractPluginSpecsFromParsedConfig(parsed);
    if (specs.some((spec) => isStatusPluginSpec(spec, "tui"))) {
      statusPluginConfigPaths.push(path);
    }
  }

  return statusPluginConfigPaths;
}

export async function inspectTuiConfig(params?: InspectTuiConfigParams): Promise<TuiConfigDiagnostics> {
  const roots = resolveTuiConfigRoots(params);
  const candidatePaths = getTuiConfigCandidatePaths(roots);
  const presentPaths = candidatePaths.filter((path) => existsSync(path));
  const statusPluginConfigPaths = await findStatusPluginConfigPaths(presentPaths);

  return {
    workspaceRoot: roots.workspaceRoot,
    configRoot: roots.configRoot,
    configured: presentPaths.length > 0,
    inferredSelectedPath: presentPaths[presentPaths.length - 1] ?? null,
    presentPaths,
    candidatePaths,
    statusPluginConfigured: statusPluginConfigPaths.length > 0,
    statusPluginConfigPaths,
  };
}
