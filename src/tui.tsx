/** @jsxImportSource @opentui/solid */
import type { JSX } from "@opentui/solid";
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiPromptRef,
} from "@opencode-ai/plugin/tui";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";

import type { CompactStatusState, SidebarPanelState } from "./lib/tui-panel-state.js";

import {
  getCompactStatusText,
  getSidebarPanelLines,
  shouldRenderCompactStatus,
  shouldRenderSidebarPanel,
} from "./lib/tui-panel-state.js";
import { getSidebarBodyLineColor } from "./lib/tui-line-style.js";
import {
  loadTuiHomeCompactStatus,
  loadTuiSessionStatusSurfaces,
  resolveTuiSurfaceRegistration,
} from "./lib/tui-runtime.js";

const id = "status-provider";
// Place Status near the top so variable-height built-in sections
// (MCP/LSP/Todo/Files) do not push it below the visible fold.
const SIDEBAR_ORDER = 150;
const COMPACT_ORDER = 90;
const REFRESH_INTERVAL_MS = 60_000;
const EVENT_REFRESH_DELAYS_MS = [150, 600] as const;
const MOUNT_RECOVERY_DELAYS_MS = [500, 1_500, 4_000] as const;

type SessionStatusResource = {
  sessionID: string;
  sidebar: () => SidebarPanelState;
  compact: () => CompactStatusState;
  retain: () => SessionStatusResource;
  release: () => void;
};

type HomeCompactResource = {
  compact: () => CompactStatusState;
  retain: () => HomeCompactResource;
  release: () => void;
};

const sessionResources = new WeakMap<TuiPluginApi, Map<string, SessionStatusResource>>();
const homeResources = new WeakMap<TuiPluginApi, HomeCompactResource>();

function getSessionResourceMap(api: TuiPluginApi): Map<string, SessionStatusResource> {
  const existing = sessionResources.get(api);
  if (existing) return existing;

  const next = new Map<string, SessionStatusResource>();
  sessionResources.set(api, next);
  return next;
}

function createSessionStatusResource(api: TuiPluginApi, sessionID: string): SessionStatusResource {
  const [sidebar, setSidebar] = createSignal<SidebarPanelState>({
    status: "loading",
    lines: [],
  });
  const [compact, setCompact] = createSignal<CompactStatusState>({ status: "loading" });

  let refCount = 0;
  let disposed = false;
  let loadVersion = 0;
  let inFlight = false;
  let queued = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const reload = () => {
    if (disposed) return;

    if (inFlight) {
      queued = true;
      loadVersion += 1;
      return;
    }

    inFlight = true;
    const currentVersion = ++loadVersion;

    void loadTuiSessionStatusSurfaces({ api, sessionID })
      .then((next) => {
        if (disposed || currentVersion !== loadVersion) return;
        setSidebar(next.sidebar);
        setCompact(next.compact);
      })
      .catch(() => {
        if (disposed || currentVersion !== loadVersion) return;
      })
      .finally(() => {
        if (disposed) return;
        inFlight = false;
        if (queued) {
          queued = false;
          reload();
        }
      });
  };

  const queueRefresh = (delay: number) => {
    if (disposed) return;

    const timer = setTimeout(() => {
      timers.delete(timer);
      reload();
    }, delay);
    timers.add(timer);
  };

  const scheduleRefresh = () => {
    for (const delay of EVENT_REFRESH_DELAYS_MS) queueRefresh(delay);
  };

  // TUI/session state can hydrate asynchronously after mount or session switch,
  // so retry a few times to recover from empty first-load reads.
  const scheduleMountRecovery = () => {
    for (const delay of MOUNT_RECOVERY_DELAYS_MS) queueRefresh(delay);
  };

  const interval = setInterval(reload, REFRESH_INTERVAL_MS);
  const unsubscribers = [
    api.event.on("session.updated", (event) => {
      if (event.properties?.info?.id === sessionID) {
        scheduleRefresh();
      }
    }),
    api.event.on("message.updated", (event) => {
      if (event.properties?.info?.sessionID === sessionID) {
        scheduleRefresh();
      }
    }),
    api.event.on("message.removed", (event) => {
      if (event.properties?.sessionID === sessionID) {
        scheduleRefresh();
      }
    }),
    api.event.on("tui.session.select", (event) => {
      if (event.properties?.sessionID === sessionID) {
        scheduleRefresh();
      }
    }),
  ];

  const dispose = () => {
    if (disposed) return;

    disposed = true;
    clearInterval(interval);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const unsubscribe of unsubscribers) unsubscribe();
    getSessionResourceMap(api).delete(sessionID);
  };

  const resource: SessionStatusResource = {
    sessionID,
    sidebar,
    compact,
    retain: () => {
      refCount += 1;
      return resource;
    },
    release: () => {
      refCount -= 1;
      if (refCount <= 0) dispose();
    },
  };

  reload();
  scheduleMountRecovery();

  return resource;
}

function acquireSessionStatusResource(api: TuiPluginApi, sessionID: string): SessionStatusResource {
  const resources = getSessionResourceMap(api);
  const existing = resources.get(sessionID);
  if (existing) return existing.retain();

  const next = createSessionStatusResource(api, sessionID).retain();
  resources.set(sessionID, next);
  return next;
}

function createHomeCompactResource(api: TuiPluginApi): HomeCompactResource {
  const [compact, setCompact] = createSignal<CompactStatusState>({ status: "loading" });

  let refCount = 0;
  let disposed = false;
  let loadVersion = 0;
  let inFlight = false;
  let queued = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const reload = () => {
    if (disposed) return;

    if (inFlight) {
      queued = true;
      loadVersion += 1;
      return;
    }

    inFlight = true;
    const currentVersion = ++loadVersion;

    void loadTuiHomeCompactStatus({ api })
      .then((next) => {
        if (disposed || currentVersion !== loadVersion) return;
        setCompact(next);
      })
      .catch(() => {
        if (disposed || currentVersion !== loadVersion) return;
      })
      .finally(() => {
        if (disposed) return;
        inFlight = false;
        if (queued) {
          queued = false;
          reload();
        }
      });
  };

  const queueRefresh = (delay: number) => {
    if (disposed) return;

    const timer = setTimeout(() => {
      timers.delete(timer);
      reload();
    }, delay);
    timers.add(timer);
  };

  const scheduleRefresh = () => {
    for (const delay of EVENT_REFRESH_DELAYS_MS) queueRefresh(delay);
  };

  const interval = setInterval(reload, REFRESH_INTERVAL_MS);
  const unsubscribers = [
    api.event.on("session.updated", scheduleRefresh),
    api.event.on("message.updated", scheduleRefresh),
    api.event.on("message.removed", scheduleRefresh),
    api.event.on("tui.session.select", scheduleRefresh),
  ];

  const dispose = () => {
    if (disposed) return;

    disposed = true;
    clearInterval(interval);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const unsubscribe of unsubscribers) unsubscribe();
    homeResources.delete(api);
  };

  const resource: HomeCompactResource = {
    compact,
    retain: () => {
      refCount += 1;
      return resource;
    },
    release: () => {
      refCount -= 1;
      if (refCount <= 0) dispose();
    },
  };

  reload();

  return resource;
}

function acquireHomeCompactResource(api: TuiPluginApi): HomeCompactResource {
  const existing = homeResources.get(api);
  if (existing) return existing.retain();

  const next = createHomeCompactResource(api).retain();
  homeResources.set(api, next);
  return next;
}

function useSessionStatusResource(api: TuiPluginApi, sessionID: () => string): () => SessionStatusResource {
  let current = acquireSessionStatusResource(api, sessionID());
  const [resource, setResource] = createSignal(current);

  createEffect(() => {
    const nextSessionID = sessionID();
    if (current.sessionID === nextSessionID) return;

    const previous = current;
    current = acquireSessionStatusResource(api, nextSessionID);
    setResource(current);
    previous.release();
  });

  onCleanup(() => {
    current.release();
  });

  return resource;
}

function SidebarContentView(props: {
  api: TuiPluginApi;
  sessionID: string;
}) {
  const resource = useSessionStatusResource(props.api, () => props.sessionID);
  const panel = () => resource().sidebar();

  const lines = () => getSidebarPanelLines(panel());

  return (
    <Show when={shouldRenderSidebarPanel(panel())}>
      <box gap={0}>
        <text fg={props.api.theme.current.text}>
          <b>Status</b>
        </text>
        <box gap={0}>
          {lines().map((line) => (
            <text fg={getSidebarBodyLineColor(line, props.api.theme.current)} wrapMode="none">
              {line || " "}
            </text>
          ))}
        </box>
      </box>
    </Show>
  );
}

function CompactStatusLine(props: {
  api: TuiPluginApi;
  panel: () => CompactStatusState;
  justifyContent: "flex-start" | "center" | "flex-end";
  blankLineBefore?: boolean;
}) {
  const text = () => {
    const panel = props.panel();
    if (!shouldRenderCompactStatus(panel)) return "";
    return getCompactStatusText(panel);
  };

  // Always render the box. When used as the OpenCode `hint` prop, the slot
  // is mounted once by the host and a missing outer wrapper would never
  // appear later, so the inner text must update reactively instead.
  const line = (
    <box flexDirection="row" justifyContent={props.justifyContent}>
      <text fg={props.api.theme.current.textMuted} wrapMode="none">
        {text()}
      </text>
    </box>
  );

  if (props.blankLineBefore) {
    return (
      <box gap={0}>
        <text> </text>
        {line}
      </box>
    );
  }

  return line;
}

function SessionPromptRightWithCompactLine(props: {
  api: TuiPluginApi;
  sessionID: string;
  visible?: boolean;
  disabled?: boolean;
  onSubmit?: () => void;
  promptRef?: (ref: TuiPromptRef | undefined) => void;
}) {
  const resource = useSessionStatusResource(props.api, () => props.sessionID);
  const panel = () => resource().compact();

  return <CompactStatusLine api={props.api} panel={panel} justifyContent="flex-end" />;
}

function HomeCompactStatusView(props: { api: TuiPluginApi }) {
  const resource = acquireHomeCompactResource(props.api);
  onCleanup(() => resource.release());

  return (
    <CompactStatusLine
      api={props.api}
      panel={resource.compact}
      justifyContent="center"
      blankLineBefore
    />
  );
}

function registerSidebarSlots(api: TuiPluginApi): void {
  api.slots.register({
    order: SIDEBAR_ORDER,
    slots: {
      sidebar_content(_ctx, props: { session_id: string }) {
        return <SidebarContentView api={api} sessionID={props.session_id} />;
      },
    },
  });
}

const tui: TuiPlugin = async (api) => {
  let surfaceRegistration;
  try {
    surfaceRegistration = await resolveTuiSurfaceRegistration(api);
  } catch {
    registerSidebarSlots(api);
    return;
  }

  if (surfaceRegistration.sidebar.enabled) {
    registerSidebarSlots(api);
  }

  const compactRegistration = surfaceRegistration.compact;
  if (!compactRegistration.enabled) return;

  const compactSlots: Record<string, (ctx: any, props: any) => JSX.Element | null> = {};

  if (compactRegistration.sessionPrompt) {
    // Register against `session_prompt_right`, which OpenCode renders beside
    // the native prompt. This avoids competing with other plugins that own
    // `session_prompt` while still keeping status visible.
    compactSlots.session_prompt_right = (
      _ctx,
      props: {
        session_id: string;
        visible?: boolean;
        disabled?: boolean;
        on_submit?: () => void;
        ref?: (ref: TuiPromptRef | undefined) => void;
      },
    ) => (
      <SessionPromptRightWithCompactLine
        api={api}
        sessionID={props.session_id}
        visible={props.visible}
        disabled={props.disabled}
        onSubmit={props.on_submit}
        promptRef={props.ref}
      />
    );
  }

  if (compactRegistration.homeBottom) {
    compactSlots.home_bottom = () => <HomeCompactStatusView api={api} />;
  }

  if (Object.keys(compactSlots).length > 0) {
    api.slots.register({
      order: COMPACT_ORDER,
      slots: compactSlots,
    });
  }
};

const pluginModule: TuiPluginModule & { id: string } = {
  id,
  tui,
};

export default pluginModule;
