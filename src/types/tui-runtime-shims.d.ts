declare module "@opentui/solid" {
  export namespace JSX {
    interface Element {}
    interface IntrinsicElements {
      box: any;
      text: any;
      b: any;
      span: any;
      scrollbox: any;
    }
  }

  export type SolidPlugin<Slots = Record<string, object>, Context = unknown> = {
    order?: number;
    slots?: Record<string, (ctx: Context, props: any) => JSX.Element | null>;
  };
}

declare module "@opentui/solid/jsx-runtime" {
  export namespace JSX {
    interface Element {}
    interface IntrinsicElements {
      box: any;
      text: any;
      b: any;
      span: any;
      scrollbox: any;
    }
  }

  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare module "solid-js" {
  export function createSignal<T>(value: T): [() => T, (value: T | ((prev: T) => T)) => T];
  export function createEffect(fn: () => void): void;
  export function onCleanup(fn: () => void): void;
  export function Show<T>(props: {
    when: T | undefined | null | false;
    children?: any;
    fallback?: any;
  }): any;
}

declare module "@opencode-ai/plugin/tui" {
  import type { JSX, SolidPlugin } from "@opentui/solid";

  export type TuiPromptInfo = {
    input: string;
    parts: ReadonlyArray<unknown>;
  };

  export type TuiPromptRef = {
    focused: boolean;
    current: TuiPromptInfo;
    set(prompt: TuiPromptInfo): void;
    reset(): void;
    blur(): void;
    focus(): void;
    submit(): void;
  };

  export type TuiPromptProps = {
    sessionID?: string;
    workspaceID?: string;
    visible?: boolean;
    disabled?: boolean;
    onSubmit?: () => void;
    ref?: (ref: TuiPromptRef | undefined) => void;
    hint?: JSX.Element;
    right?: JSX.Element;
    showPlaceholder?: boolean;
    placeholders?: {
      normal?: string[];
      shell?: string[];
    };
  };

  export type TuiPluginApi = {
    route: {
      current:
        | { name: "home" }
        | { name: "session"; params: { sessionID: string } }
        | { name: string; params?: Record<string, unknown> };
    };
    command?: {
      register: (
        cb: () => Array<{
          title: string;
          value: string;
          description?: string;
          category?: string;
          slash?: { name: string; aliases?: string[] };
          onSelect?: () => void | Promise<void>;
        }>,
      ) => () => void;
    };
    state: {
      provider: ReadonlyArray<{ id: string }>;
      path: {
        worktree: string;
        directory: string;
      };
      session: {
        messages: (sessionID: string) => ReadonlyArray<any>;
        get?: (sessionID: string) =>
          | {
              model?: { id?: string; providerID?: string; variant?: string };
              agent?: string;
            }
          | undefined;
      };
    };
    theme: {
      current: {
        text: unknown;
        textMuted: unknown;
      };
    };
    ui: {
      Prompt: (props: TuiPromptProps) => JSX.Element;
      toast: (input: {
        variant?: "info" | "success" | "warning" | "error";
        message: string;
        duration?: number;
      }) => void;
    };
    event: {
      on: (type: string, handler: (event: any) => void) => () => void;
    };
    slots: {
      register: (
        plugin: Omit<SolidPlugin<any, { theme: unknown }>, "id"> & {
          id?: never;
          order?: number;
          slots: Record<string, (ctx: any, props: any) => JSX.Element | null>;
        },
      ) => string;
    };
    lifecycle: {
      onDispose: (fn: () => void | Promise<void>) => () => void;
    };
    client: {
      config?: {
        providers?: () => Promise<{
          data?: {
            providers?: Array<{ id: string }>;
          };
        }>;
        get?: () => Promise<{
          data?: Record<string, unknown>;
        }>;
      };
      session?: {
        get?: (params: {
          sessionID: string;
          directory?: string;
          workspace?: string;
        }) => Promise<{
          data?: {
            model?: { id?: string; providerID?: string; variant?: string };
            agent?: string;
          };
        }>;
        prompt?: (params: {
          sessionID: string;
          noReply?: boolean;
          parts: Array<{ type: "text"; text: string; ignored?: boolean }>;
        }) => Promise<unknown>;
      };
    };
  };

  export type TuiPluginMeta = {
    state: "first" | "updated" | "same";
    id: string;
    source: string;
    spec: string;
    target: string;
    requested?: string;
    version?: string;
    modified?: number;
    first_time: number;
    last_time: number;
    time_changed: number;
    load_count: number;
    fingerprint: string;
  };

  export type TuiPlugin = (
    api: TuiPluginApi,
    options: unknown,
    meta: TuiPluginMeta,
  ) => Promise<void>;

  export type TuiPluginModule = {
    id?: string;
    tui: TuiPlugin;
    server?: never;
  };
}
