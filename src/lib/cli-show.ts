import { resolve } from "path";

import type { StatusRuntimeClient } from "./status-runtime-context.js";
import type { StatusProviderConfig } from "./types.js";

import { formatStatusRows } from "./format.js";
import { getStatusProviderShape } from "./provider-metadata.js";
import { findGitWorktreeRoot, getEffectiveConfigRoot } from "./config-file-utils.js";
import {
  loadConfiguredOpenCodeConfig,
  loadConfiguredProviderIds,
} from "./opencode-config-providers.js";
import { resolveStatusFormatStyle } from "./status-format-style.js";
import { getPackageVersion } from "./version.js";
import { collectStatusRenderData } from "./status-render-data.js";
import { sanitizeStatusRenderData } from "./display-sanitize.js";
import {
  createStatusRuntimeRequestContext,
  resolveStatusRuntimeContext,
} from "./status-runtime-context.js";

export interface RunCliShowCommandOptions {
  argv?: string[];
  cwd?: string;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

type ParsedShowArgs =
  | { ok: true; providerId?: string; help: boolean }
  | { ok: false; error: string };

const SHOW_USAGE = [
  "Usage:",
  "  npx status-provider show [--provider <provider-id>]",
  "",
  "Options:",
  "  --provider <provider-id>  Show status for one provider",
  "  --help, -h                Show help",
].join("\n");

function parseShowArgs(argv: string[]): ParsedShowArgs {
  let providerId: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { ok: true, help: true };
    }

    if (arg === "--provider") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        return { ok: false, error: "Missing value for --provider." };
      }
      if (providerId) {
        return { ok: false, error: "Specify --provider only once." };
      }
      providerId = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--provider=")) {
      const value = arg.slice("--provider=".length).trim();
      if (!value) {
        return { ok: false, error: "Missing value for --provider." };
      }
      if (providerId) {
        return { ok: false, error: "Specify --provider only once." };
      }
      providerId = value;
      continue;
    }

    if (arg.startsWith("-")) {
      return { ok: false, error: `Unknown option: ${arg}` };
    }

    return { ok: false, error: `Unexpected argument: ${arg}` };
  }

  return { ok: true, providerId, help: false };
}

function cloneCliConfig(config: StatusProviderConfig): StatusProviderConfig {
  return {
    ...config,
    enabledProviders: Array.isArray(config.enabledProviders)
      ? [...config.enabledProviders]
      : config.enabledProviders,
    googleModels: [...config.googleModels],
    opencodeGoWindows: [...config.opencodeGoWindows],
    pricingSnapshot: { ...config.pricingSnapshot },
    layout: { ...config.layout },
    showSessionTokens: false,
  };
}

function resolveCliRoots(cwd: string): { workspaceRoot: string; configRoot: string; fallbackDirectory: string } {
  const fallbackDirectory = resolve(cwd);
  const worktreeRoot = findGitWorktreeRoot(fallbackDirectory) ?? fallbackDirectory;
  const configRoot = getEffectiveConfigRoot(worktreeRoot);
  return {
    workspaceRoot: worktreeRoot,
    configRoot,
    fallbackDirectory,
  };
}

function createCliStatusClient(params: { configRootDir: string }): StatusRuntimeClient {
  let configPromise: Promise<Record<string, unknown>> | undefined;
  let providerIdsPromise: Promise<string[]> | undefined;

  return {
    config: {
      get: async () => {
        configPromise ??= loadConfiguredOpenCodeConfig({
          configRootDir: params.configRootDir,
        });
        return {
          data: (await configPromise) as {
            experimental?: { statusProvider?: Partial<StatusProviderConfig> };
            model?: string;
          },
        };
      },
      providers: async () => {
        providerIdsPromise ??= loadConfiguredProviderIds({
          configRootDir: params.configRootDir,
        });
        const ids = await providerIdsPromise;
        return {
          data: {
            providers: ids.map((id) => ({ id })),
          },
        };
      },
    },
  };
}

function writeLine(stream: Pick<NodeJS.WriteStream, "write">, message: string): void {
  stream.write(message.endsWith("\n") ? message : `${message}\n`);
}

export async function runCliShowCommand(options: RunCliShowCommandOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(3);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const parsed = parseShowArgs(argv);
  if (!parsed.ok) {
    writeLine(stderr, parsed.error);
    writeLine(stderr, SHOW_USAGE);
    return 1;
  }

  if (parsed.help) {
    writeLine(stdout, SHOW_USAGE);
    return 0;
  }

  const providerId = parsed.providerId ? getStatusProviderShape(parsed.providerId)?.id : undefined;
  if (parsed.providerId && !providerId) {
    writeLine(stderr, `Unknown provider: ${parsed.providerId}`);
    return 1;
  }

  try {
    const roots = resolveCliRoots(options.cwd ?? process.cwd());
    const client = createCliStatusClient({ configRootDir: roots.configRoot });
    const runtime = await resolveStatusRuntimeContext({
      client,
      roots,
      includeSessionMeta: false,
    });

    if (!runtime.config.enabled) {
      writeLine(stderr, "Status disabled in config (enabled: false).");
      return 1;
    }

    const config = cloneCliConfig(runtime.config);
    if (providerId) {
      config.enabledProviders = [providerId];
    }

    const result = await collectStatusRenderData({
      client: runtime.client,
      config,
      configMeta: runtime.configMeta,
      request: createStatusRuntimeRequestContext(runtime),
      surfaceExplicitProviderIssues: true,
      formatStyle: resolveStatusFormatStyle(config.formatStyle),
      providers: runtime.providers,
    });

    if (!result.data) {
      writeLine(stderr, "No status data available.");
      return 1;
    }

    const data = sanitizeStatusRenderData(result.data);
    const version = (await getPackageVersion()) ?? "";
    const output = formatStatusRows({
      version,
      layout: config.layout,
      entries: data.entries,
      errors: data.errors,
      style: resolveStatusFormatStyle(config.formatStyle),
      percentDisplayMode: config.percentDisplayMode,
      textVariant: config.textVariant,
      providerNameVariant: config.providerNameVariant,
      percentVariant: config.percentVariant,
      colorVariant: config.colorVariant,
      alignmentVariant: config.alignmentVariant,
    });

    if (!output.trim()) {
      writeLine(stderr, "No status data available.");
      return 1;
    }

    writeLine(stdout, output);
    return data.entries.length > 0 ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeLine(stderr, `Failed to show status: ${message}`);
    return 1;
  }
}
