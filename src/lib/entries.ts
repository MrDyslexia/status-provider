import type { CursorStatusPlan, OpenCodeGoWindowKey } from "./types.js";

/**
 * Normalized status output model.
 *
 * Providers should map their internal status shapes into these types so that
 * formatting and toast display stays universal across providers.
 */

export interface GroupedStatusEntryMeta {
  /** Optional provider/account group header for grouped toast and /status output. */
  group?: string;
  /** Optional row label inside the group, e.g. "5h:" or "Usage:". */
  label?: string;
  /** Optional compact right-hand summary, e.g. "42/300". */
  right?: string;
}

export type StatusProviderEntry =
  | (GroupedStatusEntryMeta & {
      /**
       * Percent-based entry (default).
       * Note: kind is optional for backwards compatibility.
       */
      kind?: "percent";

      /** Display label (already human-friendly), e.g. "Copilot" or "Claude (abc..gmail)". */
      name: string;

      /** Remaining status as a percentage (may be below 0 when over status). */
      percentRemaining: number;

      /** Optional ISO reset timestamp (shown when percentRemaining is < 100). */
      resetTimeIso?: string;
    })
  | (GroupedStatusEntryMeta & {
      /** Value-based entry (no percent bar). */
      kind: "value";

      /** Display label (already human-friendly), e.g. "OpenCode Go". */
      name: string;

      /** Human-readable value, e.g. "$42.50". */
      value: string;

      /** Optional ISO reset timestamp (shown when available). */
      resetTimeIso?: string;
    });

export function isValueEntry(
  e: StatusProviderEntry,
): e is Extract<StatusProviderEntry, { kind: "value" }> {
  return e.kind === "value";
}

export function isPercentEntry(
  e: StatusProviderEntry,
): e is Extract<StatusProviderEntry, { percentRemaining: number }> {
  return !isValueEntry(e);
}

export interface StatusProviderError {
  /** Short label that will be rendered as "label: message". */
  label: string;
  message: string;
  /**
   * True when this error is a transient auth/token issue that is expected to
   * self-heal on its own (e.g. an OAuth token refresh in progress or a
   * backoff window after a rejected token). The cache layer uses this to
   * shorten how long the error is served, and formatters use it to render a
   * "reauthenticating" indicator instead of a hard failure.
   */
  retryable?: boolean;
}

/** Per-model token summary for current session (toast display). */
export interface SessionTokenModel {
  modelID: string;
  input: number;
  cachedInput?: number;
  totalInput?: number;
  output: number;
}

/** Session tokens data for toast display. */
export interface SessionTokensData {
  models: SessionTokenModel[];
  totalInput: number;
  totalCachedInput?: number;
  totalCombinedInput?: number;
  totalOutput: number;
}

export interface StatusProviderPresentation {
  singleWindowDisplayName?: string;
  singleWindowShowRight?: boolean;
}

export interface StatusProviderResult {
  /** True when provider had enough configuration to attempt a query. */
  attempted: boolean;
  entries: StatusProviderEntry[];
  errors: StatusProviderError[];
  presentation?: StatusProviderPresentation;
  /**
   * Epoch ms until which the provider is rate-limited and should not be hit
   * again. While in the future, the cache layer should reuse the last-known
   * entries (stale-data fallback) rather than calling the provider.
   */
  rateLimitedUntil?: number;
}

export interface StatusProviderMatchContext {
  enabledProviders: string[] | "auto";
}

export interface StatusProviderContext {
  client: {
    config: {
      providers: () => Promise<{ data?: { providers: Array<{ id: string }> } }>;
      get: () => Promise<{ data?: { model?: string } }>;
    };
  };
  config: {
    googleModels: string[];
    anthropicBinaryPath?: string;
    alibabaCodingPlanTier: "lite" | "pro";
    cursorPlan: CursorStatusPlan;
    cursorIncludedApiUsd?: number;
    cursorBillingCycleStartDay?: number;
    opencodeGoWindows?: OpenCodeGoWindowKey[];
    requestTimeoutMs?: number;
    /** True when requestTimeoutMs came from user config rather than DEFAULT_CONFIG. */
    requestTimeoutMsConfigured?: boolean;
    onlyCurrentModel?: boolean;
    currentModel?: string;
    currentProviderID?: string;
    enabledProviders: string[] | "auto";
  };
}

export interface StatusProvider {
  /** Stable id used by config.enabledProviders */
  id: string;

  /** Best-effort availability check (no network if possible) */
  isAvailable: (ctx: StatusProviderContext) => Promise<boolean>;

  /** Fetch and normalize status for this provider */
  fetch: (ctx: StatusProviderContext) => Promise<StatusProviderResult>;

  /** Optional provider match for onlyCurrentModel filtering */
  matchesCurrentModel?: (model: string, context?: StatusProviderMatchContext) => boolean;
}
