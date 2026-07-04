/**
 * Type definitions for status-provider plugin
 */

import type { StatusFormatStyle } from "./status-format-style.js";
import { DEFAULT_STATUS_FORMAT_STYLE } from "./status-format-style.js";

// =============================================================================
// Configuration Types
// =============================================================================

/** Google model identifiers */
export type GoogleModelId = "G3PRO" | "G3FLASH" | "CLAUDE" | "G3IMAGE";
export type GeminiCliAuthSourceKey =
  | "google-gemini-cli"
  | "gemini-cli"
  | "opencode-gemini-auth"
  | "gemini"
  | "google";
export type CursorStatusPlan = "none" | "pro" | "pro-plus" | "ultra";
export type PricingSnapshotSource = "auto" | "bundled" | "runtime";
export type PercentDisplayMode = "remaining" | "used";
export type OpenCodeGoWindowKey = "rolling" | "weekly" | "monthly";

export type StatusTextVariant = "default" | "minimal" | "box" | "emoji";
export type StatusProviderNameVariant = "full" | "short" | "icon";
export type StatusPercentVariant = "number" | "bar" | "both";
export type StatusColorVariant = "auto" | "none";
export type StatusAlignmentVariant = "left" | "right";

export interface PricingSnapshotConfig {
  source: PricingSnapshotSource;
  autoRefresh: number;
}

export interface TuiSidebarPanelConfig {
  enabled: boolean;
}

export interface TuiCompactStatusConfig {
  enabled: boolean;
  homeBottom: boolean;
  sessionPrompt: boolean;
  suppressWhenNativeProviderStatus: boolean;
  maxWidth: number;
}

/** Request timeout in milliseconds */
export const REQUEST_TIMEOUT_MS = 5000;

/** Plugin configuration from status-provider/config.json. */
export interface StatusProviderConfig {
  enabled: boolean;

  /** If false, never show popup toasts (commands/tools still work). */
  enableToast: boolean;

  /**
   * Shared status-row formatting style for popup toasts and the TUI sidebar.
   *
   * Canonical values:
   * - "singleWindow": collapse each provider to a single displayable status window
   * - "allWindows": render all status windows
   *
   * Legacy aliases "classic" and "grouped" remain accepted for backward compatibility.
   */
  formatStyle: StatusFormatStyle;
  /** Shared percent meaning for popup toasts and the TUI sidebar. */
  percentDisplayMode: PercentDisplayMode;
  minIntervalMs: number;

  /** Request timeout in milliseconds for remote provider API calls. */
  requestTimeoutMs: number;

  /**
   * Debug mode for troubleshooting.
   *
   * When enabled, the plugin appends a short debug footer to the toast.
   * If the plugin would normally show no toast (e.g. enabledProviders empty),
   * it will show a debug-only toast explaining why.
   */
  debug: boolean;

  /**
   * Provider ids to query.
   *
   * Keep this list short and user-friendly; each provider advertises a stable id.
   * Example: ["copilot", "google-antigravity"].
   *
   * When set to "auto" (or left unconfigured), the plugin will auto-enable
   * all providers whose `isAvailable()` returns true at runtime.
   */
  enabledProviders: string[] | "auto";

  /**
   * Explicit display order for providers in toast, sidebar and /status-provider output.
   *
   * Providers not listed here are appended in their default registry order.
   * This also implicitly disables any provider that is not present in the list
   * when `enabledProviders` is "auto" and `providerOrder` is non-empty.
   */
  providerOrder: string[];

  /**
   * Visual text style variants for status displays.
   */
  textVariant: StatusTextVariant;
  providerNameVariant: StatusProviderNameVariant;
  percentVariant: StatusPercentVariant;
  colorVariant: StatusColorVariant;
  alignmentVariant: StatusAlignmentVariant;

  /** Path or command name for the local Claude CLI used by Anthropic probing. */
  anthropicBinaryPath: string;

  googleModels: GoogleModelId[];
  alibabaCodingPlanTier: AlibabaCodingPlanTier;
  cursorPlan: CursorStatusPlan;
  /**
   * Which OpenCode Go usage windows to display.
   * Defaults to ["rolling", "weekly", "monthly"].
   */
  opencodeGoWindows: OpenCodeGoWindowKey[];
  cursorIncludedApiUsd?: number;
  cursorBillingCycleStartDay?: number;
  pricingSnapshot: PricingSnapshotConfig;
  showOnIdle: boolean;
  showOnQuestion: boolean;
  showOnCompact: boolean;
  showOnBothFail: boolean;
  /** Toast duration in milliseconds */
  toastDurationMs: number;

  /** If true, only show status for current model */
  onlyCurrentModel: boolean;

  /**
   * If true, show the Session input/output tokens section in status displays when session token data is available.
   * "allWindows" keeps per-model rows on toast + sidebar; "singleWindow"
   * uses a one-line total summary.
   * The `/status-provider` command keeps its detailed per-model rendering.
   */
  showSessionTokens: boolean;

  /** TUI sidebar panel visibility when the TUI plugin is installed. */
  tuiSidebarPanel: TuiSidebarPanelConfig;

  /** Opt-in compact status/status text for TUI prompt/home surfaces. */
  tuiCompactStatus: TuiCompactStatusConfig;

  /** Responsive toast layout breakpoints (not used by the fixed-width TUI sidebar). */
  layout: {
    /** Default max width target for toast formatting */
    maxWidth: number;
    /** If toast max width is <= this, use compact layout */
    narrowAt: number;
    /** If toast max width is <= this, use ultra-compact layout */
    tinyAt: number;
  };
}

/** Default configuration values */
export const DEFAULT_CONFIG: StatusProviderConfig = {
  enabled: true,

  enableToast: true,
  formatStyle: DEFAULT_STATUS_FORMAT_STYLE,
  percentDisplayMode: "remaining",
  minIntervalMs: 300000, // 5 minutes
  requestTimeoutMs: REQUEST_TIMEOUT_MS,

  debug: false,

  // Providers are auto-detected by default; set to explicit list to opt-in manually.
  enabledProviders: "auto" as const,

  providerOrder: [],

  textVariant: "default" as const,
  providerNameVariant: "full" as const,
  percentVariant: "both" as const,
  colorVariant: "none" as const,
  alignmentVariant: "left" as const,

  anthropicBinaryPath: "claude",

  // If Google Antigravity is enabled, default to Claude only.
  googleModels: ["CLAUDE"],
  alibabaCodingPlanTier: "lite",
  cursorPlan: "none",
  opencodeGoWindows: ["rolling", "weekly", "monthly"],
  pricingSnapshot: {
    source: "auto",
    autoRefresh: 7,
  },

  showOnIdle: true,
  showOnQuestion: true,
  showOnCompact: true,
  showOnBothFail: true,
  toastDurationMs: 9000,
  onlyCurrentModel: false,
  showSessionTokens: true,
  tuiSidebarPanel: {
    enabled: true,
  },
  tuiCompactStatus: {
    enabled: false,
    homeBottom: true,
    sessionPrompt: true,
    suppressWhenNativeProviderStatus: true,
    maxWidth: 96,
  },
  layout: {
    maxWidth: 50,
    narrowAt: 42,
    tinyAt: 32,
  },
};

// =============================================================================
// Auth Data Types (from ~/.local/share/opencode/auth.json)
// =============================================================================

/** GitHub Copilot authentication data */
export interface CopilotAuthData {
  type: string;
  refresh?: string;
  access?: string;
  expires?: number;
}

export type AlibabaCodingPlanTier = "lite" | "pro";

export interface QwenOAuthAuthData {
  type: string;
  access?: string;
  refresh?: string;
  expires?: number;
  plan?: string;
  tier?: string;
  [key: string]: unknown;
}

export interface CursorOAuthAuthData {
  type: string;
  access?: string;
  refresh?: string;
  expires?: number;
  [key: string]: unknown;
}

export interface OpenAIOAuthData {
  type: string;
  access?: string;
  refresh?: string;
  expires?: number;
  accountId?: string;
  [key: string]: unknown;
}

export interface GeminiCliOAuthAuthData {
  type: string;
  access?: string;
  refresh?: string;
  expires?: number;
  projectId?: string;
  /** Legacy spelling used by some companion/runtime variants */
  projectID?: string;
  managedProjectId?: string;
  statusProjectId?: string;
  email?: string;
  accountEmail?: string;
  login?: string;
  [key: string]: unknown;
}

export interface AlibabaAuthData {
  type: string;
  key?: string;
  access?: string;
  tier?: string;
  plan?: string;
  [key: string]: unknown;
}

export interface NanoGptAuthData {
  type: "api";
  key: string;
}

export interface SyntheticAuthData {
  type: "api";
  key: string;
}

export interface MiniMaxAuthData {
  type: string;
  key?: string;
  access?: string;
}

/**
 * Copilot subscription tier.
 * See: https://docs.github.com/en/copilot/about-github-copilot/subscription-plans-for-github-copilot
 */
export type CopilotTier = "free" | "pro" | "pro+" | "business" | "enterprise";

/**
 * Copilot status token configuration.
 *
 * Stored locally in:
 * - OpenCode runtime config candidate directories as
 *   `.../opencode/copilot-status-token.json`
 *   (for example `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`)
 *
 * Users can create a fine-grained PAT with "Plan" read permission
 * to enable status checking via GitHub's public billing API.
 */
export interface CopilotStatusConfig {
  /** Fine-grained PAT with GitHub billing-report access */
  token: string;
  /** Optional user login override for user-scoped reports or org user filtering */
  username?: string;
  /**
   * Optional organization slug.
   *
   * In business mode, this selects
   * `/organizations/{org}/settings/billing/premium_request/usage`.
   *
   * In enterprise mode with an explicit `enterprise` slug, this becomes the
   * optional `organization` query filter on the enterprise usage report.
   */
  organization?: string;
  /**
   * Optional enterprise slug for enterprise-scoped premium request reports.
   *
   * When present, the plugin queries
   * `/enterprises/{enterprise}/settings/billing/premium_request/usage`.
   */
  enterprise?: string;
  /** Copilot subscription tier (used for personal-tier fallback status math) */
  tier: CopilotTier;
}

/**
 * Anthropic OAuth credential entry written to `auth.json` by
 * companion plugins like `opencode-anthropic-login-via-cli`.
 *
 * The companion plugin (cemalturkcan) writes the OAuth token to
 * `~/.local/share/opencode/auth.json > anthropic` with this format.
 */
export interface AnthropicAuthData {
  type: "oauth";
  access?: string;
  refresh?: string;
  expires?: number;
}

/** Full auth.json structure (partial - only what we need) */
export interface AuthData {
  "github-copilot"?: CopilotAuthData;
  copilot?: CopilotAuthData;
  "copilot-chat"?: CopilotAuthData;
  "github-copilot-chat"?: CopilotAuthData;
  /**
   * Anthropic OAuth credentials written by `opencode-anthropic-login-via-cli`
   * and similar companion plugins.
   */
  anthropic?: AnthropicAuthData;
  // Provider id used by opencode-gemini-auth.
  google?: GeminiCliOAuthAuthData;
  // Canonical and compatibility keys for Gemini CLI auth snapshots.
  "google-gemini-cli"?: GeminiCliOAuthAuthData;
  "gemini-cli"?: GeminiCliOAuthAuthData;
  "opencode-gemini-auth"?: GeminiCliOAuthAuthData;
  gemini?: GeminiCliOAuthAuthData;
  openai?: OpenAIOAuthData;
  // Some OpenCode installs store ChatGPT auth under "codex".
  codex?: OpenAIOAuthData;
  // Some OpenCode installs store ChatGPT auth under "chatgpt".
  chatgpt?: OpenAIOAuthData;
  // Some OpenCode installs store OpenAI auth under "opencode".
  opencode?: OpenAIOAuthData;
  synthetic?: SyntheticAuthData;
  chutes?: {
    type: string;
    key?: string;
  };
  nanogpt?: NanoGptAuthData;
  "nano-gpt"?: NanoGptAuthData;
  cursor?: CursorOAuthAuthData;
  // Canonical OpenCode provider id used by the Qwen auth plugin.
  "qwen-code"?: QwenOAuthAuthData;
  // Legacy package-name key kept for backward compatibility with older installs.
  "opencode-qwencode-auth"?: QwenOAuthAuthData;
  alibaba?: AlibabaAuthData;
  "alibaba-coding-plan"?: AlibabaAuthData;
  "zai-coding-plan"?: {
    type: "api";
    key: string;
  };
  "zhipu-coding-plan"?: {
    type: "api";
    key: string;
  };
  "minimax-coding-plan"?: MiniMaxAuthData;
  "minimax-china-coding-plan"?: MiniMaxAuthData;
  "minimax-cn-coding-plan"?: MiniMaxAuthData;
  "kimi-code"?: KimiAuthData;
  kimi?: KimiAuthData;
}

// =============================================================================
// Antigravity Account Types (from ~/.config/opencode/antigravity-accounts.json)
// =============================================================================

/** Single Antigravity account from opencode-antigravity-auth storage */
export interface AntigravityAccount {
  email?: string;
  refreshToken: string;
  projectId?: string;
  /** Legacy spelling used by some plugin versions */
  projectID?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  rateLimitResetTimes?: Record<string, number>;
}

/** Antigravity accounts file structure */
export interface AntigravityAccountsFile {
  version: number;
  accounts: AntigravityAccount[];
  activeIndex?: number;
  activeIndexByFamily?: {
    claude?: number;
    gemini?: number;
  };
}

// =============================================================================
// Google Antigravity Types
// =============================================================================

/** Google status API response */
export interface GoogleStatusResponse {
  models: Record<
    string,
    {
      statusInfo?: {
        remainingFraction?: number;
        resetTime?: string;
      };
    }
  >;
}

// =============================================================================
// Kimi Types
// =============================================================================

/** Kimi auth entry in auth.json */
export interface KimiAuthData {
  type: "api";
  key: string;
}

/** Kimi status window */
export interface KimiStatusWindow {
  label: string;
  used: number;
  limit: number;
  percentRemaining: number;
  resetTimeIso?: string;
}

/** Result from fetching Kimi status */
export interface KimiStatusResult {
  success: true;
  label: string;
  windows: KimiStatusWindow[];
}

export type KimiResult = KimiStatusResult | StatusError | null;

// =============================================================================
// Z.ai Types
// =============================================================================

/** Z.ai auth entry in auth.json */
export interface ZaiAuthData {
  type: "api";
  key: string;
}

/** Z.ai status limit entry from API */
export interface ZaiStatusLimit {
  type: string;
  unit: number;
  number: number;
  usage: number;
  currentValue?: number;
  remaining?: number;
  percentage: number;
  nextResetTime?: number;
  usageDetails?: Array<{
    modelCode: string;
    usage: number;
  }>;
}

/** Z.ai API response */
export interface ZaiStatusResponse {
  code: number;
  msg: string;
  data: {
    limits: ZaiStatusLimit[];
    level: string;
  };
  success: boolean;
}

/** Result from fetching Z.ai status */
export interface ZaiStatusResult {
  success: true;
  label: string;
  windows: {
    fiveHour?: { percentRemaining: number; resetTimeIso?: string };
    weekly?: { percentRemaining: number; resetTimeIso?: string };
    mcp?: { percentRemaining: number; resetTimeIso?: string };
  };
}

// =============================================================================
// Status Result Types
// =============================================================================

/** Result from fetching per-user Copilot status */
export interface CopilotStatusResult {
  success: true;
  mode: "user_status";
  used: number;
  total: number;
  percentRemaining: number;
  unlimited?: boolean;
  resetTimeIso?: string;
}

/** Result from fetching organization-scoped Copilot premium usage */
export interface CopilotOrganizationUsageResult {
  success: true;
  mode: "organization_usage";
  organization: string;
  username?: string;
  period: {
    year: number;
    month: number;
  };
  used: number;
  resetTimeIso?: string;
}

/** Result from fetching enterprise-scoped Copilot premium usage */
export interface CopilotEnterpriseUsageResult {
  success: true;
  mode: "enterprise_usage";
  enterprise: string;
  organization?: string;
  username?: string;
  period: {
    year: number;
    month: number;
  };
  used: number;
  resetTimeIso?: string;
}

/** Result from fetching Google status for a single model */
export interface GoogleModelStatus {
  modelId: GoogleModelId;
  displayName: string;
  percentRemaining: number;
  resetTimeIso?: string;
  accountEmail?: string;
}

/** Error for a single account */
export interface GoogleAccountError {
  email: string;
  error: string;
}

export interface GeminiCliStatusBucket {
  modelId: string;
  displayName: string;
  percentRemaining: number;
  resetTimeIso?: string;
  remainingAmount?: string;
  tokenType?: string;
  accountEmail?: string;
  sourceKey?: GeminiCliAuthSourceKey;
}

export interface GeminiCliStatusResult {
  success: true;
  buckets: GeminiCliStatusBucket[];
  errors?: GoogleAccountError[];
}

/** Result from fetching Google status */
export interface GoogleStatusResult {
  success: true;
  models: GoogleModelStatus[];
  errors?: GoogleAccountError[];
}

/** Error result */
export interface StatusError {
  success: false;
  error: string;
}

/** Combined status result */
export type CopilotResult =
  | CopilotStatusResult
  | CopilotOrganizationUsageResult
  | CopilotEnterpriseUsageResult
  | StatusError
  | null;
export type GoogleResult = GoogleStatusResult | StatusError | null;
export type GeminiCliResult = GeminiCliStatusResult | StatusError | null;
export type ZaiResult = ZaiStatusResult | StatusError | null;
/** Single entry in a MiniMax status result */
export interface MiniMaxResultEntry {
  window: "five_hour" | "weekly";
  name: string;
  group?: string;
  label?: string;
  right?: string;
  percentRemaining: number;
  resetTimeIso?: string;
}

export type MiniMaxResult =
  | {
      success: true;
      entries: MiniMaxResultEntry[];
    }
  | StatusError;
export type ChutesResult =
  | {
      success: true;
      percentRemaining: number;
      resetTimeIso?: string;
    }
  | StatusError
  | null;
export type CrofResult =
  | {
      success: true;
      credits: number;
      requestsPlan: number;
      usableRequests: number;
      percentRemaining: number;
    }
  | StatusError
  | null;
export interface SyntheticStatusWindow {
  limit: number;
  used: number;
  percentRemaining: number;
  resetTimeIso?: string;
}
export type SyntheticResult =
  | {
      success: true;
      windows: {
        fiveHour: SyntheticStatusWindow;
        weekly: SyntheticStatusWindow;
      };
    }
  | StatusError
  | null;

/** Single usage window from OpenCode Go dashboard */
export interface OpenCodeGoWindow {
  /** Usage percentage [0..100] */
  usagePercent: number;
  /** Seconds until usage resets */
  resetInSec: number;
  /** Remaining percentage [0..100] */
  percentRemaining: number;
  /** ISO reset timestamp */
  resetTimeIso: string;
}

/** Result from scraping OpenCode Go dashboard usage */
export type OpenCodeGoResult =
  | {
      success: true;
      /** Rolling (~5h) usage window, when present in the dashboard payload */
      rolling?: OpenCodeGoWindow;
      /** Weekly usage window, when present in the dashboard payload */
      weekly?: OpenCodeGoWindow;
      /** Monthly usage window, when present in the dashboard payload */
      monthly?: OpenCodeGoWindow;
    }
  | StatusError
  | null;

/** Cached toast data */
export interface CachedToast {
  message: string;
  timestamp: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Model key mapping for Google API */
export const GOOGLE_MODEL_KEYS: Record<
  GoogleModelId,
  { key: string; altKey?: string; display: string }
> = {
  G3PRO: {
    key: "gemini-3.1-pro",
    altKey: "gemini-3.1-pro-high|gemini-3.1-pro-low|gemini-3-pro-high|gemini-3-pro-low",
    display: "G3Pro",
  },
  G3FLASH: { key: "gemini-3-flash", display: "G3Flash" },
  CLAUDE: {
    key: "claude-opus-4-6-thinking",
    altKey: "claude-opus-4-5-thinking|claude-opus-4-5",
    display: "Claude",
  },
  G3IMAGE: { key: "gemini-3-pro-image", display: "G3Image" },
};
