import { readFile } from "fs/promises";
import { getEffectiveConfigRoot } from "./config-file-utils.js";
import { getStatusProviderConfigPath, type LoadConfigMeta } from "./config.js";
import { writeJsonAtomic } from "./atomic-json.js";
import { getProviders } from "../providers/registry.js";
import {
  getStatusProviderDisplayLabel,
  getStatusProviderShape,
  normalizeStatusProviderId,
} from "./provider-metadata.js";
import type { StatusProviderConfig } from "./types.js";

const ESC = "\x1B[";

export interface StatusConfigCommandParams {
  sessionID: string;
  configRootDir?: string;
  config: StatusProviderConfig;
  configMeta: LoadConfigMeta;
  args: Record<string, unknown>;
}

export interface StatusConfigCommandResult {
  output: string;
  saved: boolean;
}

export async function runStatusConfigCommand(
  params: StatusConfigCommandParams,
): Promise<StatusConfigCommandResult> {
  const configRootDir =
    params.configRootDir ?? getEffectiveConfigRoot(process.cwd());
  const configPath = getStatusProviderConfigPath(configRootDir);

  const existing = await readConfigFile(configPath);
  const nextData: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};

  const changes: string[] = [];
  const errors: string[] = [];

  if ("enabledProviders" in params.args) {
    const raw = params.args.enabledProviders;
    if (raw === "auto") {
      delete nextData.enabledProviders;
      changes.push("enabledProviders: auto");
    } else if (Array.isArray(raw)) {
      const ids = raw
        .filter((v): v is string => typeof v === "string")
        .map((id) => normalizeStatusProviderId(id));
      const validIds = ids.filter((id) => getStatusProviderShape(id));
      const invalidIds = ids.filter((id) => !getStatusProviderShape(id));
      if (invalidIds.length > 0) {
        errors.push(`unknown provider ids: ${invalidIds.join(", ")}`);
      }
      if (validIds.length === 0) {
        nextData.enabledProviders = [];
        changes.push("enabledProviders: []");
      } else {
        nextData.enabledProviders = validIds;
        changes.push(`enabledProviders: [${validIds.join(", ")}]`);
      }
    } else {
      errors.push("enabledProviders must be 'auto' or an array of provider ids");
    }
  }

  if ("providerOrder" in params.args) {
    const raw = params.args.providerOrder;
    if (Array.isArray(raw)) {
      const ids = raw
        .filter((v): v is string => typeof v === "string")
        .map((id) => normalizeStatusProviderId(id));
      const validIds = ids.filter((id) => getStatusProviderShape(id));
      const invalidIds = ids.filter((id) => !getStatusProviderShape(id));
      if (invalidIds.length > 0) {
        errors.push(`unknown provider ids in providerOrder: ${invalidIds.join(", ")}`);
      }
      if (validIds.length === 0) {
        delete nextData.providerOrder;
        changes.push("providerOrder: removed");
      } else {
        nextData.providerOrder = validIds;
        changes.push(`providerOrder: [${validIds.join(", ")}]`);
      }
    } else {
      errors.push("providerOrder must be an array of provider ids");
    }
  }

  if (errors.length > 0) {
    return {
      output: formatResult({
        config: params.config,
        configPath,
        saved: false,
        changes,
        errors,
      }),
      saved: false,
    };
  }

  const hasChanges = changes.length > 0;
  if (hasChanges) {
    try {
      await writeJsonAtomic(configPath, nextData, { trailingNewline: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        output: formatResult({
          config: params.config,
          configPath,
          saved: false,
          changes,
          errors: [message],
        }),
        saved: false,
      };
    }
  }

  return {
    output: formatResult({
      config: params.config,
      configPath,
      saved: hasChanges,
      changes,
      errors,
    }),
    saved: hasChanges,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readConfigFile(path: string): Promise<unknown> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

interface FormatResultParams {
  config: StatusProviderConfig;
  configPath: string;
  saved: boolean;
  changes: string[];
  errors: string[];
}

function formatResult(params: FormatResultParams): string {
  const allProviders = getProviders();
  const enabled =
    params.config.enabledProviders === "auto"
      ? "auto"
      : params.config.enabledProviders.join(", ");

  const lines = [
    "# Status Config",
    "",
    `configPath: ${params.configPath}`,
    `saved: ${params.saved ? "yes" : "no"}`,
    "",
    "current:",
    `  enabledProviders: ${enabled || "(none)"}`,
    `  providerOrder: ${params.config.providerOrder.join(", ") || "(default)"}`,
    "",
    "available providers:",
    ...allProviders.map((p) => `  ${p.id} — ${getStatusProviderDisplayLabel(p.id)}`),
  ];

  if (params.changes.length > 0) {
    lines.push("", "changes:");
    for (const change of params.changes) {
      lines.push(`  + ${change}`);
    }
  }

  if (params.errors.length > 0) {
    lines.push("", "errors:");
    for (const error of params.errors) {
      lines.push(`  - ${error}`);
    }
  }

  lines.push(
    "",
    "examples:",
    '  /status_config {"enabledProviders":"auto"}',
    '  /status_config {"enabledProviders":["copilot","openai"]}',
    '  /status_config {"providerOrder":["openai","copilot","anthropic"]}',
    '  /status_config {"enabledProviders":["copilot"],"providerOrder":["copilot"]}',
  );

  return lines.join("\n");
}
