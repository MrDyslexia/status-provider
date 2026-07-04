import type { LoadConfigMeta } from "./config.js";
import type { StatusProvider, StatusProviderContext } from "./entries.js";
import type { StatusProviderConfig } from "./types.js";
import type { RuntimeContextRootHints, RuntimeContextRoots } from "./config-file-utils.js";

import { createLoadConfigMeta, loadConfig } from "./config.js";
import { getOrderedProviders } from "../providers/registry.js";
import { resolveRuntimeContextRoots } from "./config-file-utils.js";

export type StatusRuntimeClient = NonNullable<Parameters<typeof loadConfig>[0]> &
  StatusProviderContext["client"];

export interface StatusSessionModelContext {
  modelID?: string;
  providerID?: string;
}

export interface ResolveStatusRuntimeContextParams {
  client: StatusRuntimeClient;
  roots: RuntimeContextRootHints;
  config?: StatusProviderConfig;
  sessionID?: string;
  sessionMeta?: StatusSessionModelContext;
  resolveSessionMeta?: (sessionID: string) => Promise<StatusSessionModelContext>;
  includeSessionMeta?: boolean | ((config: StatusProviderConfig) => boolean);
  configMeta?: LoadConfigMeta;
  providers?: StatusProvider[];
}

export interface StatusRuntimeContext {
  client: StatusRuntimeClient;
  roots: RuntimeContextRoots;
  config: StatusProviderConfig;
  configMeta: LoadConfigMeta;
  providers: StatusProvider[];
  session: {
    sessionID?: string;
    sessionMeta?: StatusSessionModelContext;
  };
}

export function shouldIncludeSessionMeta(params: {
  config: StatusProviderConfig;
  includeSessionMeta?: ResolveStatusRuntimeContextParams["includeSessionMeta"];
}): boolean {
  if (typeof params.includeSessionMeta === "function") {
    return params.includeSessionMeta(params.config);
  }

  return params.includeSessionMeta === true;
}

export async function resolveStatusRuntimeContext(
  params: ResolveStatusRuntimeContextParams,
): Promise<StatusRuntimeContext> {
  const roots = resolveRuntimeContextRoots(params.roots);
  const configMeta = params.configMeta ?? createLoadConfigMeta();
  const config =
    params.config ??
    (await loadConfig(params.client, configMeta, {
      configRootDir: roots.configRoot,
    }));

  let sessionMeta = params.sessionMeta;
  if (
    !sessionMeta &&
    params.sessionID &&
    params.resolveSessionMeta &&
    shouldIncludeSessionMeta({
      config,
      includeSessionMeta: params.includeSessionMeta,
    })
  ) {
    sessionMeta = await params.resolveSessionMeta(params.sessionID);
  }

  return {
    client: params.client,
    roots,
    config,
    configMeta,
    providers: params.providers ?? getOrderedProviders(config),
    session: {
      sessionID: params.sessionID,
      sessionMeta,
    },
  };
}

export function createStatusRuntimeRequestContext(
  runtime: Pick<StatusRuntimeContext, "session">,
): {
  sessionID?: string;
  sessionMeta?: StatusSessionModelContext;
} {
  return {
    sessionID: runtime.session.sessionID,
    sessionMeta: runtime.session.sessionMeta,
  };
}

export function createStatusProviderRuntimeContext(
  runtime: Pick<StatusRuntimeContext, "client" | "config" | "session"> &
    Partial<Pick<StatusRuntimeContext, "configMeta">>,
): StatusProviderContext {
  return {
    client: runtime.client,
    config: {
      googleModels: runtime.config.googleModels,
      anthropicBinaryPath: runtime.config.anthropicBinaryPath,
      alibabaCodingPlanTier: runtime.config.alibabaCodingPlanTier,
      cursorPlan: runtime.config.cursorPlan,
      cursorIncludedApiUsd: runtime.config.cursorIncludedApiUsd,
      cursorBillingCycleStartDay: runtime.config.cursorBillingCycleStartDay,
      opencodeGoWindows: runtime.config.opencodeGoWindows,
      requestTimeoutMs: runtime.config.requestTimeoutMs,
      requestTimeoutMsConfigured: Boolean(runtime.configMeta?.settingSources.requestTimeoutMs),
      onlyCurrentModel: runtime.config.onlyCurrentModel,
      enabledProviders:
        runtime.config.enabledProviders === "auto"
          ? "auto"
          : [...runtime.config.enabledProviders],
      currentModel: runtime.session.sessionMeta?.modelID,
      currentProviderID: runtime.session.sessionMeta?.providerID,
    },
  };
}
