import {
  extractProviderOptionsApiKey,
  getApiKeyCheckedPaths,
  getFirstAuthEntryValue,
  getGlobalOpencodeConfigCandidatePaths,
  resolveApiKeyFromEnvAndConfig,
} from "./api-key-resolver.js";
import { sanitizeDisplayText } from "./display-sanitize.js";
import { getAuthPaths, readAuthFileCached } from "./opencode-auth.js";

import type { AuthData, ZaiAuthData } from "./types.js";

export const DEFAULT_ZAI_AUTH_CACHE_MAX_AGE_MS = 5_000;
const ZAI_AUTH_KEYS = ["zai-coding-plan"] as const;
const ZAI_PROVIDER_KEYS = ["zai", "zai-coding-plan", "glm"] as const;
const ALLOWED_ZAI_ENV_VARS = ["ZAI_API_KEY", "ZAI_CODING_PLAN_API_KEY"] as const;

export type ZaiKeySource =
  | "env:ZAI_API_KEY"
  | "env:ZAI_CODING_PLAN_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

export type ResolvedZaiAuth =
  | { state: "none" }
  | { state: "configured"; apiKey: string }
  | { state: "invalid"; error: string };

export type ZaiAuthDiagnostics =
  | {
      state: "none";
      source: null;
      checkedPaths: string[];
      authPaths: string[];
    }
  | {
      state: "configured";
      source: ZaiKeySource;
      checkedPaths: string[];
      authPaths: string[];
    }
  | {
      state: "invalid";
      source: "auth.json";
      checkedPaths: string[];
      authPaths: string[];
      error: string;
    };

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

function getZaiAuthEntry(auth: AuthData | null | undefined): unknown {
  return getFirstAuthEntryValue(auth, ZAI_AUTH_KEYS);
}

function isZaiAuthData(value: unknown): value is ZaiAuthData {
  return value !== null && typeof value === "object";
}

function sanitizeZaiAuthValue(value: string): string {
  const sanitized = sanitizeDisplayText(value).replace(/\s+/g, " ").trim();
  return (sanitized || "unknown").slice(0, 120);
}

export function resolveZaiAuth(auth: AuthData | null | undefined): ResolvedZaiAuth {
  const zai = getZaiAuthEntry(auth);
  if (zai === null || zai === undefined) {
    return { state: "none" };
  }

  if (!isZaiAuthData(zai)) {
    return { state: "invalid", error: "Z.ai auth entry has invalid shape" };
  }

  if (typeof zai.type !== "string") {
    return { state: "invalid", error: "Z.ai auth entry present but type is missing or invalid" };
  }

  if (zai.type !== "api") {
    return {
      state: "invalid",
      error: `Unsupported Z.ai auth type: "${sanitizeZaiAuthValue(zai.type)}"`,
    };
  }

  const key = typeof zai.key === "string" ? zai.key.trim() : "";
  if (!key) {
    return { state: "invalid", error: "Z.ai auth entry present but key is empty" };
  }

  return { state: "configured", apiKey: key };
}

async function resolveZaiAuthWithSource(params?: {
  maxAgeMs?: number;
}): Promise<{ auth: ResolvedZaiAuth; source: ZaiKeySource | null }> {
  const resolvedFromEnvOrConfig = await resolveApiKeyFromEnvAndConfig<ZaiKeySource>({
    envVars: [
      { name: "ZAI_API_KEY", source: "env:ZAI_API_KEY" },
      {
        name: "ZAI_CODING_PLAN_API_KEY",
        source: "env:ZAI_CODING_PLAN_API_KEY",
      },
    ],
    extractFromConfig: (config) =>
      extractProviderOptionsApiKey(config, {
        providerKeys: ZAI_PROVIDER_KEYS,
        allowedEnvVars: ALLOWED_ZAI_ENV_VARS,
      }),
    configJsonSource: "opencode.json",
    configJsoncSource: "opencode.jsonc",
    getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  });

  if (resolvedFromEnvOrConfig) {
    return {
      auth: { state: "configured", apiKey: resolvedFromEnvOrConfig.key },
      source: resolvedFromEnvOrConfig.source,
    };
  }

  const maxAgeMs = Math.max(0, params?.maxAgeMs ?? DEFAULT_ZAI_AUTH_CACHE_MAX_AGE_MS);
  const authData = await readAuthFileCached({ maxAgeMs });
  const auth = resolveZaiAuth(authData);

  return {
    auth,
    source: auth.state === "none" ? null : "auth.json",
  };
}

export async function resolveZaiAuthCached(params?: {
  maxAgeMs?: number;
}): Promise<ResolvedZaiAuth> {
  return (await resolveZaiAuthWithSource(params)).auth;
}

export async function getZaiAuthDiagnostics(params?: {
  maxAgeMs?: number;
}): Promise<ZaiAuthDiagnostics> {
  const { auth, source } = await resolveZaiAuthWithSource(params);
  const checkedPaths = getApiKeyCheckedPaths({
    envVarNames: [...ALLOWED_ZAI_ENV_VARS],
    getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  });
  const authPaths = getAuthPaths();

  if (auth.state === "none") {
    return {
      state: "none",
      source: null,
      checkedPaths,
      authPaths,
    };
  }

  if (auth.state === "invalid") {
    return {
      state: "invalid",
      source: "auth.json",
      checkedPaths,
      authPaths,
      error: auth.error,
    };
  }

  return {
    state: "configured",
    source: source ?? "auth.json",
    checkedPaths,
    authPaths,
  };
}
