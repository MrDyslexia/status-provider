import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { CompactStatusState, SidebarPanelState } from "./tui-panel-state.js";

import type { CollectStatusRenderDataResult, SessionModelMeta } from "./status-render-data.js";
import type { StatusRuntimeContext } from "./status-runtime-context.js";

import {
  resolveRuntimeContextRoots,
  type RuntimeContextRootHints,
} from "./config-file-utils.js";
import { createStatusRuntimeRequestContext, resolveStatusRuntimeContext } from "./status-runtime-context.js";
import { collectStatusRenderData } from "./status-render-data.js";
import { resolveStatusFormatStyle } from "./status-format-style.js";
import { buildCompactStatusStatusLine } from "./tui-compact-format.js";
import { hasNativeProviderStatusClient } from "./tui-native-provider-status.js";
import { buildSidebarStatusPanelLines } from "./tui-sidebar-format.js";

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
              data:
                response?.data && typeof response.data === "object"
                  ? response.data
                  : {},
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
  try {
    const response = await api.client.session?.get?.({ path: { id: sessionID } });
    if (response?.data?.providerID || response?.data?.modelID) {
      return {
        providerID: response.data?.providerID,
        modelID: response.data?.modelID,
      };
    }
  } catch {
    // Fall back to session message state below.
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
    surfaceExplicitProviderIssues: true,
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
    includeSessionMeta: (config) => config.onlyCurrentModel,
  });

  const sidebarEnabled = isSessionSidebarEnabled(runtime);
  const compactEnabled = isSessionCompactEnabled(runtime);

  if (!sidebarEnabled && !compactEnabled) {
    return buildDisabledSessionStatusSurfaces();
  }

  const { result, formatStyle } = await collectTuiStatusRenderData({
    runtime,
    request: createStatusRuntimeRequestContext(runtime),
  });

  return {
    sidebar: sidebarEnabled
      ? buildSidebarPanelFromData({ runtime, result, formatStyle })
      : { status: "disabled", lines: [] },
    compact: buildCompactStatusFromData({
      runtime,
      result,
      enabled: compactEnabled,
    }),
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

export async function loadSidebarPanel(params: {
  api: TuiPluginApi;
  sessionID: string;
}): Promise<SidebarPanelState> {
  return (await loadTuiSessionStatusSurfaces(params)).sidebar;
}
