import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { CompactStatusState, SidebarPanelState } from "./tui-panel-state.js";

import type { CollectStatusRenderDataResult, SessionModelMeta } from "./status-render-data.js";
import type { StatusRuntimeContext } from "./status-runtime-context.js";

import { resolveRuntimeContextRoots, type RuntimeContextRootHints } from "./config-file-utils.js";
import {
  createStatusProviderRuntimeContext,
  createStatusRuntimeRequestContext,
  resolveStatusRuntimeContext,
} from "./status-runtime-context.js";
import {
  collectStatusRenderData,
  collectStatusStatusLiveProbes,
  matchesStatusProviderCurrentSelection,
} from "./status-render-data.js";
import {
  resolveStatusFormatStyle,
  SINGLE_WINDOW_PER_PROVIDER_FORMAT_STYLE,
} from "./status-format-style.js";
import { buildCompactStatusStatusLine } from "./tui-compact-format.js";
import { hasNativeProviderStatusClient } from "./tui-native-provider-status.js";
import { buildSidebarStatusPanelLines } from "./tui-sidebar-format.js";
import { formatStatusRows } from "./format.js";
import { inspectTuiConfig } from "./tui-config-diagnostics.js";
import { buildStatusStatusReport } from "./status-status.js";

const COMPACT_UNAVAILABLE_TEXT = "Status unavailable";

function getTuiRuntimeRootHints(api: TuiPluginApi): RuntimeContextRootHints {
  return {
    worktreeRoot: api.state.path.worktree,
    activeDirectory: api.state.path.directory,
    fallbackDirectory: process.cwd(),
  };
}

export function resolveWorkspaceDir(api: TuiPluginApi): string {
  return resolveRuntimeContextRoots(getTuiRuntimeRootHints(api)).workspaceRoot;
}

function createTuiStatusClient(api: TuiPluginApi) {
  return {
    config: {
      providers: async () => {
        try {
          if (api.client.config?.providers) {
            const response = await api.client.config.providers();
            return {
              data: {
                providers: response.data?.providers ?? [],
              },
            };
          }
        } catch {
          // Fall back to TUI state provider list below.
        }

        return {
          data: {
            providers: api.state.provider.map((provider) => ({ id: provider.id })),
          },
        };
      },
      get: async () => {
        try {
          if (api.client.config?.get) {
            const response = await api.client.config.get();
            return {
              data: response?.data && typeof response.data === "object" ? response.data : {},
            };
          }
        } catch {
          // Fall back to empty config below.
        }

        return { data: {} };
      },
    },
  };
}

function getMessageSessionModelMeta(api: TuiPluginApi, sessionID: string): SessionModelMeta {
  const messages = api.state.session.messages(sessionID);
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as
      | { providerID?: string; modelID?: string; model?: { providerID?: string; modelID?: string } }
      | undefined;
    const providerID = message?.providerID ?? message?.model?.providerID;
    const modelID = message?.modelID ?? message?.model?.modelID;
    if (providerID || modelID) {
      return { providerID, modelID };
    }
  }
  return {};
}

export async function getTuiSessionModelMeta(
  api: TuiPluginApi,
  sessionID: string,
): Promise<SessionModelMeta> {
  // `state.session.get` reads synchronously from the TUI's own local session
  // state (no network round-trip, no risk of a malformed request against the
  // real v2 client), so it reflects the session's persisted model as soon as
  // it changes server-side -- i.e. right after the next message is sent
  // under a newly picked model/agent. OpenCode's plugin API does not expose
  // any signal for "the user picked a different model but hasn't sent a
  // message yet" (verified empirically: neither `session.updated` nor the
  // SDK-typed `session.next.model.switched`/`session.next.agent.switched`
  // events fire for that picker interaction in 1.17.15), so a Tab/model-pick
  // alone cannot update the compact line before the next send.
  const session = api.state.session.get?.(sessionID);
  const providerID = session?.model?.providerID;
  const modelID = session?.model?.id;
  if (providerID || modelID) {
    return { providerID, modelID };
  }

  return getMessageSessionModelMeta(api, sessionID);
}

export type TuiSidebarPanelRegistration = {
  enabled: boolean;
};

export type TuiCompactStatusRegistration = {
  enabled: boolean;
  homeBottom: boolean;
  sessionPrompt: boolean;
  hasNativeProviderStatus: boolean;
  suppressedByNativeProviderStatus: boolean;
};

export type TuiSurfaceRegistration = {
  sidebar: TuiSidebarPanelRegistration;
  compact: TuiCompactStatusRegistration;
};

export type TuiSessionStatusSurfaces = {
  sidebar: SidebarPanelState;
  compact: CompactStatusState;
};

export type TuiManualToast = {
  message: string;
  duration: number;
};

function isSessionSidebarEnabled(runtime: StatusRuntimeContext): boolean {
  return runtime.config.enabled && runtime.config.tuiSidebarPanel.enabled;
}

function isSessionCompactEnabled(runtime: StatusRuntimeContext): boolean {
  return (
    runtime.config.enabled &&
    runtime.config.tuiCompactStatus.enabled &&
    runtime.config.tuiCompactStatus.sessionPrompt
  );
}

function buildDisabledSessionStatusSurfaces(): TuiSessionStatusSurfaces {
  return {
    sidebar: { status: "disabled", lines: [] },
    compact: { status: "disabled" },
  };
}

function buildCompactStatusFromData(params: {
  runtime: StatusRuntimeContext;
  result: CollectStatusRenderDataResult;
  enabled: boolean;
  maxWidth?: number;
}): CompactStatusState {
  if (!params.enabled) return { status: "disabled" };

  if (params.result.selection?.waitingForCurrentSelection) {
    return { status: "loading" };
  }

  const text = params.result.data
    ? buildCompactStatusStatusLine({
        data: params.result.data,
        percentDisplayMode: params.runtime.config.percentDisplayMode,
        maxWidth: params.maxWidth ?? params.runtime.config.tuiCompactStatus.maxWidth,
      })
    : "";

  return {
    status: "ready",
    text: text.trim() ? text : COMPACT_UNAVAILABLE_TEXT,
  };
}

function buildSidebarPanelFromData(params: {
  runtime: StatusRuntimeContext;
  result: CollectStatusRenderDataResult;
  formatStyle: ReturnType<typeof resolveStatusFormatStyle>;
}): SidebarPanelState {
  if (params.result.selection?.waitingForCurrentSelection) {
    return {
      status: "loading",
      lines: [],
    };
  }

  return {
    status: "ready",
    lines: params.result.data
      ? buildSidebarStatusPanelLines({
          data: params.result.data,
          config: { ...params.runtime.config, formatStyle: params.formatStyle },
        })
      : [],
  };
}

async function collectTuiStatusRenderData(params: {
  runtime: StatusRuntimeContext;
  request: ReturnType<typeof createStatusRuntimeRequestContext>;
  surfaceExplicitProviderIssues?: boolean;
}): Promise<{
  result: CollectStatusRenderDataResult;
  formatStyle: ReturnType<typeof resolveStatusFormatStyle>;
}> {
  const formatStyle = resolveStatusFormatStyle(params.runtime.config.formatStyle);
  const result = await collectStatusRenderData({
    client: params.runtime.client,
    config: params.runtime.config,
    configMeta: params.runtime.configMeta,
    request: params.request,
    surfaceExplicitProviderIssues: params.surfaceExplicitProviderIssues ?? true,
    formatStyle,
    providers: params.runtime.providers,
  });

  return { result, formatStyle };
}

export async function resolveTuiSurfaceRegistration(
  api: TuiPluginApi,
): Promise<TuiSurfaceRegistration> {
  const statusClient = createTuiStatusClient(api);
  const runtime = await resolveStatusRuntimeContext({
    client: statusClient,
    roots: getTuiRuntimeRootHints(api),
  });
  const compact = runtime.config.tuiCompactStatus;
  const hasNativeProviderStatus = hasNativeProviderStatusClient(api.client);
  const suppressedByNativeProviderStatus =
    compact.suppressWhenNativeProviderStatus && hasNativeProviderStatus;
  const compactEnabled =
    runtime.config.enabled && compact.enabled && !suppressedByNativeProviderStatus;

  return {
    sidebar: {
      enabled: runtime.config.enabled && runtime.config.tuiSidebarPanel.enabled,
    },
    compact: {
      enabled: compactEnabled,
      homeBottom: compactEnabled && compact.homeBottom,
      sessionPrompt: compactEnabled && compact.sessionPrompt,
      hasNativeProviderStatus,
      suppressedByNativeProviderStatus,
    },
  };
}

export async function resolveTuiCompactStatusRegistration(
  api: TuiPluginApi,
): Promise<TuiCompactStatusRegistration> {
  return (await resolveTuiSurfaceRegistration(api)).compact;
}

// The session compact surface (docked next to the prompt) is always narrower
// than the sidebar, so it always filters down to the provider backing the
// session's current model regardless of the global `onlyCurrentModel`
// setting, which only governs the sidebar/toast surfaces.
function shouldIncludeSessionMetaForSurfaces(config: StatusRuntimeContext["config"]): boolean {
  return (
    config.onlyCurrentModel ||
    (config.tuiCompactStatus.enabled && config.tuiCompactStatus.sessionPrompt)
  );
}

function buildCompactOnlyCurrentModelRuntime(runtime: StatusRuntimeContext): StatusRuntimeContext {
  if (runtime.config.onlyCurrentModel && !runtime.config.showSessionTokens) return runtime;
  return {
    ...runtime,
    config: {
      ...runtime.config,
      onlyCurrentModel: true,
      showSessionTokens: false,
    },
  };
}

export async function loadTuiSessionStatusSurfaces(params: {
  api: TuiPluginApi;
  sessionID: string;
}): Promise<TuiSessionStatusSurfaces> {
  const statusClient = createTuiStatusClient(params.api);
  const runtime = await resolveStatusRuntimeContext({
    client: statusClient,
    roots: getTuiRuntimeRootHints(params.api),
    sessionID: params.sessionID,
    resolveSessionMeta: (sessionID) => getTuiSessionModelMeta(params.api, sessionID),
    includeSessionMeta: shouldIncludeSessionMetaForSurfaces,
  });

  const sidebarEnabled = isSessionSidebarEnabled(runtime);
  const compactEnabled = isSessionCompactEnabled(runtime);

  if (!sidebarEnabled && !compactEnabled) {
    return buildDisabledSessionStatusSurfaces();
  }

  const compactRuntime = buildCompactOnlyCurrentModelRuntime(runtime);

  const sidebarPromise = sidebarEnabled
    ? collectTuiStatusRenderData({ runtime, request: createStatusRuntimeRequestContext(runtime) })
    : undefined;

  const compactPromise = !compactEnabled
    ? undefined
    : collectTuiStatusRenderData({
        runtime: compactRuntime,
        request: createStatusRuntimeRequestContext(compactRuntime),
        surfaceExplicitProviderIssues: false,
      });

  const [sidebarCollected, compactCollected] = await Promise.all([sidebarPromise, compactPromise]);

  return {
    sidebar:
      sidebarEnabled && sidebarCollected
        ? buildSidebarPanelFromData({
            runtime,
            result: sidebarCollected.result,
            formatStyle: sidebarCollected.formatStyle,
          })
        : { status: "disabled", lines: [] },
    compact:
      compactEnabled && compactCollected
        ? buildCompactStatusFromData({
            runtime,
            result: compactCollected.result,
            enabled: true,
          })
        : { status: "disabled" },
  };
}

export async function loadTuiHomeCompactStatus(params: {
  api: TuiPluginApi;
}): Promise<CompactStatusState> {
  const statusClient = createTuiStatusClient(params.api);
  const runtime = await resolveStatusRuntimeContext({
    client: statusClient,
    roots: getTuiRuntimeRootHints(params.api),
  });

  if (
    !runtime.config.enabled ||
    !runtime.config.tuiCompactStatus.enabled ||
    !runtime.config.tuiCompactStatus.homeBottom
  ) {
    return { status: "disabled" };
  }

  const homeRuntime: StatusRuntimeContext = {
    ...runtime,
    config: {
      ...runtime.config,
      onlyCurrentModel: false,
      showSessionTokens: false,
    },
    session: {},
  };

  const { result } = await collectTuiStatusRenderData({
    runtime: homeRuntime,
    request: createStatusRuntimeRequestContext(homeRuntime),
  });

  return buildCompactStatusFromData({
    runtime: homeRuntime,
    result,
    enabled: true,
  });
}

export async function loadTuiManualToast(params: {
  api: TuiPluginApi;
  sessionID: string;
}): Promise<TuiManualToast | null> {
  const statusClient = createTuiStatusClient(params.api);
  const runtime = await resolveStatusRuntimeContext({
    client: statusClient,
    roots: getTuiRuntimeRootHints(params.api),
    sessionID: params.sessionID,
    resolveSessionMeta: (sessionID) => getTuiSessionModelMeta(params.api, sessionID),
    includeSessionMeta: (config) => config.onlyCurrentModel,
  });
  if (!runtime.config.enabled) return null;

  const result = await collectStatusRenderData({
    client: runtime.client,
    config: runtime.config,
    configMeta: runtime.configMeta,
    request: createStatusRuntimeRequestContext(runtime),
    surfaceExplicitProviderIssues: true,
    formatStyle: resolveStatusFormatStyle(runtime.config.formatStyle),
    bypassProviderCache: true,
    providers: runtime.providers,
  });
  if (!result.data) return null;

  const message = formatStatusRows({
    version: "1.0.0",
    layout: runtime.config.layout,
    entries: result.data.entries,
    errors: result.data.errors,
    style: resolveStatusFormatStyle(runtime.config.formatStyle),
    percentDisplayMode: runtime.config.percentDisplayMode,
    sessionTokens: result.data.sessionTokens,
    textVariant: runtime.config.toastTextVariant,
    providerNameVariant: runtime.config.toastProviderNameVariant,
    percentVariant: runtime.config.toastPercentVariant,
    colorVariant: runtime.config.toastColorVariant,
    alignmentVariant: runtime.config.toastAlignmentVariant,
  });

  return message.trim() ? { message, duration: runtime.config.toastDurationMs } : null;
}

export async function loadTuiProviderInfoReport(params: {
  api: TuiPluginApi;
  sessionID: string;
}): Promise<string | null> {
  const statusClient = createTuiStatusClient(params.api);
  const runtime = await resolveStatusRuntimeContext({
    client: statusClient,
    roots: getTuiRuntimeRootHints(params.api),
    sessionID: params.sessionID,
    resolveSessionMeta: (sessionID) => getTuiSessionModelMeta(params.api, sessionID),
    includeSessionMeta: true,
  });
  if (!runtime.config.enabled) return null;

  const currentModel = runtime.session.sessionMeta?.modelID;
  const currentProviderID = runtime.session.sessionMeta?.providerID;
  const providerContext = createStatusProviderRuntimeContext(runtime);
  const isAutoMode = runtime.config.enabledProviders === "auto";
  const availability = await Promise.all(
    runtime.providers.map(async (provider) => {
      let available = false;
      try {
        available = await provider.isAvailable(providerContext);
      } catch {
        available = false;
      }
      return {
        id: provider.id,
        enabled: isAutoMode ? available : runtime.config.enabledProviders.includes(provider.id),
        available,
        matchesCurrentModel:
          currentModel || currentProviderID
            ? matchesStatusProviderCurrentSelection({
                provider,
                currentModel,
                currentProviderID,
                enabledProviders: runtime.config.enabledProviders,
              })
            : undefined,
      };
    }),
  );
  const availabilityById = new Map(availability.map((item) => [item.id, item] as const));
  const liveProviders = runtime.providers.filter((provider) => {
    const item = availabilityById.get(provider.id);
    return item?.enabled && item.available;
  });
  const providerLiveProbes = await collectStatusStatusLiveProbes({
    client: runtime.client,
    config: runtime.config,
    configMeta: runtime.configMeta,
    request: createStatusRuntimeRequestContext(runtime),
    formatStyle: SINGLE_WINDOW_PER_PROVIDER_FORMAT_STYLE,
    providers: liveProviders,
  });
  const tuiDiagnostics = await inspectTuiConfig({ roots: runtime.roots });

  return await buildStatusStatusReport({
    tuiDiagnostics,
    configSource: runtime.configMeta.source,
    configPaths: runtime.configMeta.paths,
    globalConfigPaths: runtime.configMeta.globalConfigPaths,
    workspaceConfigPaths: runtime.configMeta.workspaceConfigPaths,
    settingSources: runtime.configMeta.settingSources,
    configIssues: runtime.configMeta.configIssues,
    enabledProviders: runtime.config.enabledProviders,
    anthropicBinaryPath: runtime.config.anthropicBinaryPath,
    alibabaCodingPlanTier: runtime.config.alibabaCodingPlanTier,
    cursorPlan: runtime.config.cursorPlan,
    cursorIncludedApiUsd: runtime.config.cursorIncludedApiUsd,
    cursorBillingCycleStartDay: runtime.config.cursorBillingCycleStartDay,
    opencodeGoWindows: runtime.config.opencodeGoWindows,
    pricingSnapshotSource: runtime.config.pricingSnapshot.source,
    onlyCurrentModel: runtime.config.onlyCurrentModel,
    currentModel,
    sessionModelLookup: currentModel ? "ok" : "not_found",
    providerAvailability: availability,
    providerLiveProbes,
    googleRefresh: { attempted: false },
    geminiCliClient: statusClient,
    generatedAtMs: Date.now(),
  });
}

export async function loadSidebarPanel(params: {
  api: TuiPluginApi;
  sessionID: string;
}): Promise<SidebarPanelState> {
  return (await loadTuiSessionStatusSurfaces(params)).sidebar;
}
