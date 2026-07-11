/**
 * Anthropic Claude status probing.
 *
 * Uses the local Claude CLI/runtime to detect install/auth state first. When
 * Claude auth is confirmed but local status windows are missing, it falls back
 * to Claude OAuth credentials (macOS Keychain first, then the local credentials
 * file) and Anthropic's OAuth usage endpoint.
 */

import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { stat } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

import { sanitizeDisplaySnippet, sanitizeDisplayText } from "./display-sanitize.js";
import { fetchWithTimeout } from "./http.js";
import { getAuthPath, invalidateAuthFileCache, readAuthFileCached } from "./opencode-auth.js";
import {
  refreshAnthropicAuth,
  isExpiringSoon,
  type AnthropicAuthEntry,
} from "./anthropic-credentials.js";

const DEFAULT_CLAUDE_BINARY = "claude";
const CLAUDE_COMMAND_TIMEOUT_MS = 3_000;
const ANTHROPIC_DIAGNOSTICS_TTL_MS = 5_000;
const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const ANTHROPIC_BETA_HEADER = "oauth-2025-04-20";
const CLAUDE_CODE_CREDENTIALS_SERVICE = "Claude Code-credentials";
const CLAUDE_NO_LOCAL_STATUS_MESSAGE =
  "Claude CLI auth detected, but local status windows were not exposed.";
const ANTHROPIC_NO_STATUS_MESSAGE =
  "Claude CLI auth detected, but status was unavailable from both the local CLI and Claude OAuth fallback.";
const ANTHROPIC_AUTH_REFRESH_HINT_MESSAGE =
  "Status-fork will attempt to refresh the token automatically.";

/** Fallback backoff when the Anthropic API returns 429 without `Retry-After`. */
const DEFAULT_ANTHROPIC_RATE_LIMIT_BACKOFF_MS = 300_000;
const DEFAULT_ANTHROPIC_AUTH_EXPIRED_BACKOFF_MS = 300_000;
const AUTH_REFRESH_FLIGHT_WINDOW_MS = 30_000;

/**
 * Parse an HTTP `Retry-After` header value into a millisecond delay.
 *
 * Accepts either the numeric-seconds form (`"247"`) or an HTTP-date
 * (e.g. `Wed, 21 Oct 2026 07:28:00 GMT`). Returns `null` when the header is
 * absent, malformed, or in the past (caller falls back to a default).
 */
function parseAnthropicRetryAfterMs(
  headerValue: string | string[] | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (headerValue == null) return null;
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (/^\d+$/u.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return seconds > 0 ? seconds * 1000 : null;
  }

  const retryAtMs = Date.parse(trimmed);
  if (!Number.isFinite(retryAtMs)) return null;
  const delta = retryAtMs - nowMs;
  return delta > 0 ? delta : null;
}

export interface AnthropicStatusWindow {
  utilization?: number;
  used_percentage?: number;
  usedPercentage?: number;
  used_percent?: number;
  usedPercent?: number;
  percent_used?: number;
  percentUsed?: number;
  resets_at?: string;
  resetsAt?: string;
  reset_at?: string;
  resetAt?: string;
}

export interface AnthropicUsageResponse {
  five_hour: AnthropicStatusWindow;
  seven_day: AnthropicStatusWindow;
}

export interface AnthropicStatusResult {
  success: true;
  five_hour: { percentRemaining: number; resetTimeIso?: string };
  seven_day: { percentRemaining: number; resetTimeIso?: string };
}

export interface AnthropicStatusError {
  success: false;
  error: string;
  /**
   * Epoch ms until which the Anthropic OAuth usage endpoint returned 429.
   * While in the future, callers should not hit the API again and should
   * surface the last-known-good data with a small rate-limit indicator.
   */
  rateLimitedUntil?: number;
  /**
   * Epoch ms until which an expired Anthropic OAuth token should not be retried.
   */
  authExpiredUntil?: number;
}

export type AnthropicResult = AnthropicStatusResult | AnthropicStatusError | null;
export type AnthropicAuthStatus = "authenticated" | "unauthenticated" | "unknown";
export type AnthropicStatusSource =
  | "claude-auth-status-json"
  | "claude-credentials-oauth-api"
  | "auth-expired"
  | "rate-limited"
  | "none";

export interface AnthropicDiagnostics {
  installed: boolean;
  version: string | null;
  authStatus: AnthropicAuthStatus;
  statusSupported: boolean;
  statusSource: AnthropicStatusSource;
  checkedCommands: string[];
  message?: string;
  status?: AnthropicStatusResult;
  /**
   * Epoch ms until which the Anthropic API is rate-limited. Only set when
   * `statusSource === "rate-limited"`.
   */
  rateLimitedUntil?: number;
  /**
   * Epoch ms until which an expired OAuth token should not be retried.
   */
  authExpiredUntil?: number;
}

export interface AnthropicProbeOptions {
  binaryPath?: string;
  requestTimeoutMs?: number;
}

type ClaudeCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnErrorCode?: number | string;
  errorMessage?: string;
};

export type ClaudeCommandInvocation = {
  file: string;
  args: string[];
  display: string;
};

type AnthropicDiagnosticsCacheEntry = {
  timestamp: number;
  value: AnthropicDiagnostics | null;
  inFlight?: Promise<AnthropicDiagnostics>;
};

type AnthropicLocalDiagnostics = {
  installed: boolean;
  version: string | null;
  authStatus: AnthropicAuthStatus;
  checkedCommands: string[];
  message?: string;
  localStatus?: AnthropicStatusResult;
};

type AnthropicLocalDiagnosticsCacheEntry = {
  timestamp: number;
  value: AnthropicLocalDiagnostics | null;
  inFlight?: Promise<AnthropicLocalDiagnostics>;
};

type ClaudeCredentialsAccess =
  | {
      state: "configured";
      accessToken: string;
    }
  | {
      state: "unavailable";
      detail?: string;
    };

type ClaudeCredentialSourceResult =
  | {
      state: "configured";
      accessToken: string;
    }
  | {
      state: "not-found";
      location: string;
    }
  | {
      state: "unavailable";
      detail: string;
    };

type AnthropicFallbackStatus =
  | {
      state: "success";
      status: AnthropicStatusResult;
    }
  | {
      state: "auth-stale";
      detail: string;
      freshAccessToken: string;
    }
  | {
      state: "auth-expired";
      detail: string;
      authExpiredUntil: number;
    }
  | {
      state: "rate-limited";
      detail: string;
      rateLimitedUntil: number;
    }
  | {
      state: "unavailable";
      detail?: string;
    };

type ParsedAuthProbe = {
  authStatus: AnthropicAuthStatus;
  message?: string;
  jsonPayload?: unknown;
  unsupportedCommand?: boolean;
};

type AnthropicAuthState =
  | {
      state: "ok";
      accessToken: string;
      refreshToken: string;
      expires?: number;
    }
  | {
      state: "auth-refreshing";
      mtimeAgeMs?: number;
      expires?: number;
    }
  | {
      state: "auth-expired";
      expires?: number;
      mtimeMs?: number | null;
    }
  | {
      state: "no-refresh-token";
      accessToken: string;
      expires?: number;
    }
  | {
      state: "no-access-token";
    }
  | {
      state: "no-auth";
    };

const diagnosticsCache = new Map<string, AnthropicDiagnosticsCacheEntry>();
const localDiagnosticsCache = new Map<string, AnthropicLocalDiagnosticsCacheEntry>();

async function readAnthropicAuthState(): Promise<AnthropicAuthState> {
  const result: AnthropicAuthState = { state: "no-auth" };
  try {
    const auth = await readAuthFileCached({ maxAgeMs: 5_000 });
    if (!auth || typeof auth !== "object") {
      return result;
    }

    const entry = (auth as { anthropic?: unknown }).anthropic;
    if (!entry || typeof entry !== "object") {
      return result;
    }

    const oauth = entry as {
      type?: unknown;
      access?: unknown;
      refresh?: unknown;
      expires?: unknown;
    };
    if (oauth.type !== "oauth") {
      return result;
    }

    const accessToken = typeof oauth.access === "string" ? oauth.access.trim() : "";
    const refreshToken = typeof oauth.refresh === "string" ? oauth.refresh.trim() : "";
    if (!accessToken) {
      return { state: "no-access-token" };
    }
    if (!refreshToken) {
      return {
        state: "no-refresh-token",
        accessToken,
        expires: typeof oauth.expires === "number" ? oauth.expires : undefined,
      };
    }

    let mtimeMs: number | null = null;
    try {
      const info = await stat(getAuthPath());
      mtimeMs = info.mtimeMs;
    } catch {
      // Best effort: assume not in-flight.
    }

    const now = Date.now();
    const expires = typeof oauth.expires === "number" ? oauth.expires : undefined;
    const isExpired = typeof expires === "number" && now >= expires;
    const mtimeAgeMs = mtimeMs !== null ? now - mtimeMs : Number.POSITIVE_INFINITY;
    const isRefreshInFlight = isExpired && mtimeAgeMs < AUTH_REFRESH_FLIGHT_WINDOW_MS;

    if (isRefreshInFlight) {
      return { state: "auth-refreshing", mtimeAgeMs, expires };
    }
    if (isExpired) {
      return { state: "auth-expired", expires, mtimeMs };
    }

    return {
      state: "ok",
      accessToken,
      refreshToken,
      expires,
    };
  } catch {
    return result;
  }
}

function formatAnthropicAuthStateDetail(stateInfo: AnthropicAuthState): string {
  switch (stateInfo.state) {
    case "auth-expired":
      return `Anthropic OAuth access token in OpenCode auth.json is expired. ${ANTHROPIC_AUTH_REFRESH_HINT_MESSAGE}`;
    case "auth-refreshing":
      return `Anthropic OAuth token refresh appears to be in flight (auth.json written ${Math.round((stateInfo.mtimeAgeMs ?? 0) / 1000)}s ago). ${ANTHROPIC_AUTH_REFRESH_HINT_MESSAGE}`;
    case "no-refresh-token":
      return "Anthropic OAuth entry in OpenCode auth.json has no refresh token. Re-authenticate via the opencode-anthropic-login-via-cli plugin.";
    case "no-access-token":
      return "Anthropic OAuth entry in OpenCode auth.json has no access token. Re-authenticate via the opencode-anthropic-login-via-cli plugin.";
    case "no-auth":
    default:
      return "Anthropic OAuth entry not found in OpenCode auth.json.";
  }
}

export function resolveAnthropicBinaryPath(binaryPath?: string): string {
  const trimmed = binaryPath?.trim();
  return trimmed ? trimmed : DEFAULT_CLAUDE_BINARY;
}

function formatCommandDisplayArg(value: string): string {
  const sanitized = sanitizeDisplayText(value);
  return /[\s"]/u.test(sanitized) ? JSON.stringify(sanitized) : sanitized;
}

function formatCommandDisplay(parts: string[]): string {
  return parts.map(formatCommandDisplayArg).join(" ");
}

function quoteWindowsCmdArg(value: string): string {
  const escaped = value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1");
  return `"${escaped}"`;
}

function shouldBridgeClaudeCommandThroughWindowsShell(binaryPath: string): boolean {
  const normalized = binaryPath.trim().toLowerCase();
  if (!/[\\/]/u.test(normalized)) {
    return true;
  }

  return /\.(?:cmd|bat)$/u.test(normalized);
}

export function buildClaudeCommandInvocation(
  binaryPath: string,
  args: string[],
  runtime: { platform?: NodeJS.Platform; comspec?: string } = {},
): ClaudeCommandInvocation {
  const resolvedBinaryPath = resolveAnthropicBinaryPath(binaryPath);
  const display = formatCommandDisplay([resolvedBinaryPath, ...args]);

  if (
    (runtime.platform ?? process.platform) === "win32" &&
    shouldBridgeClaudeCommandThroughWindowsShell(resolvedBinaryPath)
  ) {
    return {
      file: runtime.comspec?.trim() || process.env["ComSpec"]?.trim() || "cmd.exe",
      args: ["/d", "/s", "/c", [resolvedBinaryPath, ...args].map(quoteWindowsCmdArg).join(" ")],
      display,
    };
  }

  return {
    file: resolvedBinaryPath,
    args: [...args],
    display,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeResetTimeIso(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return new Date(parsed).toISOString();
}

function normalizeUsagePercent(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function getWindowUsedPercent(window: Record<string, unknown>): number | undefined {
  const candidates = [
    window["utilization"],
    window["used_percentage"],
    window["usedPercentage"],
    window["used_percent"],
    window["usedPercent"],
    window["percent_used"],
    window["percentUsed"],
  ];

  for (const candidate of candidates) {
    const normalized = normalizeUsagePercent(candidate);
    if (normalized !== undefined) {
      return normalized;
    }
  }

  return undefined;
}

function getWindowResetTimeIso(window: Record<string, unknown>): string | undefined {
  return normalizeResetTimeIso(
    window["resets_at"] ?? window["resetsAt"] ?? window["reset_at"] ?? window["resetAt"],
  );
}

function parseStatusWindow(window: unknown): { percentRemaining: number; resetTimeIso?: string } | null {
  const record = asRecord(window);
  if (!record) {
    return null;
  }

  const used = getWindowUsedPercent(record);
  if (used === undefined) {
    return null;
  }

  return {
    percentRemaining: Math.min(100, Math.round(100 - used)),
    resetTimeIso: getWindowResetTimeIso(record),
  };
}

function getUsageRoots(data: unknown): Record<string, unknown>[] {
  const root = asRecord(data);
  if (!root) {
    return [];
  }

  const candidates = [
    root,
    asRecord(root["status"]),
    asRecord(root["usage"]),
    asRecord(root["rate_limits"]),
    asRecord(root["rateLimits"]),
    asRecord(root["oauth_usage"]),
    asRecord(root["oauthUsage"]),
  ];

  const seen = new Set<Record<string, unknown>>();
  const roots: Record<string, unknown>[] = [];

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    roots.push(candidate);
  }

  return roots;
}

function parseUsageResponse(data: unknown): AnthropicStatusResult | null {
  for (const root of getUsageRoots(data)) {
    const fiveHour = parseStatusWindow(root["five_hour"] ?? root["fiveHour"]);
    const sevenDay = parseStatusWindow(root["seven_day"] ?? root["sevenDay"]);

    if (!fiveHour || !sevenDay) {
      continue;
    }

    return {
      success: true,
      five_hour: fiveHour,
      seven_day: sevenDay,
    };
  }

  return null;
}

function getClaudeCredentialsPath(): string {
  return join(homedir(), ".claude", ".credentials.json");
}

function getClaudeKeychainLocation(): string {
  return `macOS Keychain service ${sanitizeDisplayText(CLAUDE_CODE_CREDENTIALS_SERVICE)}`;
}

function getClaudeCredentialsNotFoundDetail(locations: string[]): string {
  if (locations.length === 0) {
    return "Claude OAuth credentials were not found.";
  }

  if (locations.length === 1) {
    return `Claude OAuth credentials not found in ${locations[0]}.`;
  }

  const [head, ...tail] = locations;
  return `Claude OAuth credentials not found in ${head} or ${tail.join(" or ")}.`;
}

function buildAnthropicNoStatusDiagnosticsMessage(detail?: string): string {
  const normalizedDetail = detail?.trim();
  return normalizedDetail
    ? `${ANTHROPIC_NO_STATUS_MESSAGE} ${normalizedDetail}`
    : ANTHROPIC_NO_STATUS_MESSAGE;
}

function extractClaudeCredentialsAccessToken(data: unknown): string {
  const root = asRecord(data);
  if (!root) {
    return "";
  }

  for (const candidate of [
    asRecord(root["claudeAiOauth"]),
    asRecord(root["oauth"]),
    root,
  ]) {
    if (!candidate) {
      continue;
    }

    for (const key of ["accessToken", "access_token", "token"]) {
      const token = candidate[key];
      if (typeof token === "string" && token.trim()) {
        return token.trim();
      }
    }
  }

  return "";
}

function parseClaudeCredentialsAccessToken(
  content: string,
  options: { allowPlainText: boolean },
): { accessToken?: string; error?: string } {
  const trimmed = content.trim();
  if (!trimmed) {
    return { error: "missing" };
  }

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return options.allowPlainText ? { accessToken: trimmed } : { error: "missing" };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const accessToken = extractClaudeCredentialsAccessToken(parsed);
    return accessToken ? { accessToken } : { error: "missing" };
  } catch (error) {
    return {
      error: sanitizeDisplayText(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function runCredentialCommand(file: string, args: string[]): Promise<ClaudeCommandResult> {
  return await new Promise<ClaudeCommandResult>((resolve, reject) => {
    try {
      execFile(
        file,
        args,
        {
          encoding: "utf8",
          timeout: CLAUDE_COMMAND_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        },
        (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
          const stdoutText = typeof stdout === "string" ? stdout : stdout.toString("utf8");
          const stderrText = typeof stderr === "string" ? stderr : stderr.toString("utf8");

          if (!error) {
            resolve({
              code: 0,
              stdout: stdoutText,
              stderr: stderrText,
              timedOut: false,
            });
            return;
          }

          const execError = error as Error & { code?: number | string; killed?: boolean };
          resolve({
            code: typeof execError.code === "number" ? execError.code : null,
            stdout: stdoutText,
            stderr: stderrText,
            timedOut: isTimedOutError(execError),
            spawnErrorCode: execError.code,
            errorMessage: execError.message,
          });
        },
      );
    } catch (error) {
      reject(error);
    }
  });
}

async function readClaudeCredentialsAccessTokenFromMacOSKeychain(): Promise<ClaudeCredentialSourceResult | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  const location = getClaudeKeychainLocation();
  const result = await runCredentialCommand("security", [
    "find-generic-password",
    "-s",
    CLAUDE_CODE_CREDENTIALS_SERVICE,
    "-w",
  ]);

  if (result.code !== 0) {
    return {
      state: "not-found",
      location,
    };
  }

  const parsed = parseClaudeCredentialsAccessToken(result.stdout, { allowPlainText: true });
  if (parsed.accessToken) {
    return {
      state: "configured",
      accessToken: parsed.accessToken,
    };
  }

  return {
    state: "unavailable",
    detail:
      parsed.error && parsed.error !== "missing"
        ? `Could not parse Claude OAuth credentials from ${location}: ${parsed.error}.`
        : `Claude OAuth access token missing in ${location}.`,
  };
}

async function readClaudeCredentialsAccessTokenFromFile(): Promise<ClaudeCredentialSourceResult> {
  const credentialsPath = getClaudeCredentialsPath();

  try {
    const content = await readFile(credentialsPath, "utf8");
    const parsed = parseClaudeCredentialsAccessToken(content, { allowPlainText: false });
    const accessToken = parsed.accessToken?.trim() ?? "";

    if (!accessToken) {
      return {
        state: "unavailable",
        detail:
          parsed.error && parsed.error !== "missing"
            ? `Could not parse Claude credentials file ${sanitizeDisplayText(credentialsPath)}: ${parsed.error}.`
            : `Claude OAuth access token missing in ${sanitizeDisplayText(credentialsPath)}.`,
      };
    }

    return {
      state: "configured",
      accessToken,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string | number }).code
        : undefined;

    if (code === "ENOENT") {
      return {
        state: "not-found",
        location: sanitizeDisplayText(credentialsPath),
      };
    }

    return {
      state: "unavailable",
      detail: `Could not read Claude credentials file: ${sanitizeDisplayText(
        error instanceof Error ? error.message : String(error),
      )}`,
    };
  }
}

/**
 * Read the Anthropic OAuth credentials from OpenCode's `auth.json` (under the
 * `anthropic` key), as written by companion plugins such as
 * `opencode-anthropic-login-via-cli`.
 *
 * Returns `not-found` when there is no `auth.json`, no `anthropic` entry, or
 * the entry is not an OAuth credential. Returns `unavailable` with a `detail`
 * string when the entry exists but the access token is missing or expired.
 */
async function readClaudeCredentialsAccessTokenFromOpencodeAuth(): Promise<ClaudeCredentialSourceResult> {
  try {
    const stateInfo = await readAnthropicAuthState();
    switch (stateInfo.state) {
      case "ok":
        return { state: "configured", accessToken: stateInfo.accessToken };

      case "auth-refreshing":
        // A refresh appears in-flight already — return unavailable so the
        // caller can short-circuit gracefully without competing with it.
        return {
          state: "unavailable",
          detail: formatAnthropicAuthStateDetail(stateInfo),
        };

      case "auth-expired":
      case "no-refresh-token":
      case "no-access-token": {
        // Attempt a proactive OAuth token refresh using status-fork's own
        // credential refresh chain (mirrors opencode-anthropic-login-via-cli).
        const auth = await readAuthFileCached({ maxAgeMs: 0 });
        const entry = (auth as { anthropic?: AnthropicAuthEntry } | null)?.anthropic;
        if (entry && typeof entry === "object") {
          try {
            const fresh = await refreshAnthropicAuth(entry);
            if (fresh && !isExpiringSoon(fresh.expires)) {
              return { state: "configured", accessToken: fresh.access };
            }
          } catch {
            // fall through to unavailable
          }
        }
        return {
          state: "unavailable",
          detail: formatAnthropicAuthStateDetail(stateInfo),
        };
      }

      case "no-auth":
      default:
        return { state: "not-found", location: "OpenCode auth.json > anthropic" };
    }
  } catch {
    return { state: "not-found", location: "OpenCode auth.json" };
  }
}

async function readClaudeCredentialsAccessToken(): Promise<ClaudeCredentialsAccess> {
  const locationsChecked: string[] = [];
  const unavailableDetails: string[] = [];

  // 1. macOS Keychain (no-op on non-darwin platforms)
  const keychainCredentials = await readClaudeCredentialsAccessTokenFromMacOSKeychain();
  if (keychainCredentials?.state === "configured") {
    return keychainCredentials;
  }
  if (keychainCredentials?.state === "unavailable") {
    unavailableDetails.push(keychainCredentials.detail);
  }
  if (keychainCredentials?.state === "not-found") {
    locationsChecked.push(keychainCredentials.location);
  }

  // 2. OpenCode auth.json > anthropic (written by opencode-anthropic-login-via-cli).
  //    This is the most actively-maintained source on multi-plugin installs and
  //    is preferred over the legacy Claude CLI credentials file.
  const opencodeAuthCredentials = await readClaudeCredentialsAccessTokenFromOpencodeAuth();
  if (opencodeAuthCredentials.state === "configured") {
    return opencodeAuthCredentials;
  }
  if (opencodeAuthCredentials.state === "unavailable") {
    unavailableDetails.push(opencodeAuthCredentials.detail);
  }
  if (opencodeAuthCredentials.state === "not-found") {
    locationsChecked.push(opencodeAuthCredentials.location);
  }

  // 3. ~/.claude/.credentials.json (legacy Claude CLI source)
  const fileCredentials = await readClaudeCredentialsAccessTokenFromFile();
  if (fileCredentials.state === "configured") {
    return fileCredentials;
  }
  if (fileCredentials.state === "unavailable") {
    unavailableDetails.push(fileCredentials.detail);
  }
  if (fileCredentials.state === "not-found") {
    locationsChecked.push(fileCredentials.location);
  }
  return {
    state: "unavailable",
    detail: unavailableDetails[0] ?? getClaudeCredentialsNotFoundDetail(locationsChecked),
  };
}

async function queryAnthropicStatusFromOAuthAccessToken(
  accessToken: string,
  requestTimeoutMs?: number,
): Promise<AnthropicFallbackStatus> {
  let response: Response;

  try {
    response = await fetchWithTimeout(
      ANTHROPIC_USAGE_URL,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "anthropic-beta": ANTHROPIC_BETA_HEADER,
        },
      },
      requestTimeoutMs,
    );
  } catch (error) {
    return {
      state: "unavailable",
      detail: sanitizeDisplayText(error instanceof Error ? error.message : String(error)),
    };
  }

  if (response.status === 401 || response.status === 403) {
    invalidateAuthFileCache();
    let freshAccessToken: string | null = null;
    let freshExpires: number | null = null;
    try {
      const freshAuth = await readAuthFileCached({ maxAgeMs: 0 });
      const entry = (freshAuth as { anthropic?: unknown } | null)?.anthropic;
      if (entry && typeof entry === "object") {
        const oauth = entry as { type?: unknown; access?: unknown; expires?: unknown };
        if (oauth.type === "oauth") {
          const fresh = typeof oauth.access === "string" ? oauth.access.trim() : "";
          if (fresh && fresh !== accessToken) {
            freshAccessToken = fresh;
            freshExpires = typeof oauth.expires === "number" ? oauth.expires : null;
          }
        }
      }
    } catch {
      // Fall through to auth-expired.
    }

    if (freshAccessToken && (freshExpires === null || Date.now() < freshExpires)) {
      return {
        state: "auth-stale",
        detail: `Anthropic API error ${response.status}: token rotated, retrying with fresh token.`,
        freshAccessToken,
      };
    }

    let detail = "";
    try {
      detail = sanitizeDisplaySnippet(await response.text(), 120);
    } catch {
      detail = "";
    }

    return {
      state: "auth-expired",
      detail: `Anthropic OAuth token rejected (${response.status}). ${ANTHROPIC_AUTH_REFRESH_HINT_MESSAGE}`,
      authExpiredUntil: Date.now() + DEFAULT_ANTHROPIC_AUTH_EXPIRED_BACKOFF_MS,
    };
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = sanitizeDisplaySnippet(await response.text(), 120);
    } catch {
      detail = "";
    }

    if (response.status === 429) {
      const retryAfterMs =
        parseAnthropicRetryAfterMs(response.headers?.get("retry-after")) ??
        DEFAULT_ANTHROPIC_RATE_LIMIT_BACKOFF_MS;
      const retryUntilIso = new Date(Date.now() + retryAfterMs).toLocaleTimeString();
      return {
        state: "rate-limited",
        detail: `Claude status API rate-limited; will retry after ${retryUntilIso}.`,
        rateLimitedUntil: Date.now() + retryAfterMs,
      };
    }

    return {
      state: "unavailable",
      detail: `Anthropic API returned ${response.status}.`,
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return {
      state: "unavailable",
      detail: "Failed to parse Anthropic status response",
    };
  }

  const status = parseUsageResponse(data);
  if (!status) {
    return {
      state: "unavailable",
      detail: "Unexpected Anthropic status response shape",
    };
  }

  return {
    state: "success",
    status,
  };
}

async function queryAnthropicUsageEndpointWithRefresh(
  accessToken: string,
  requestTimeoutMs?: number,
): Promise<AnthropicFallbackStatus> {
  const first = await queryAnthropicStatusFromOAuthAccessToken(accessToken, requestTimeoutMs);
  if (first.state === "auth-stale") {
    const second = await queryAnthropicStatusFromOAuthAccessToken(
      first.freshAccessToken,
      requestTimeoutMs,
    );
    if (second.state !== "auth-stale") {
      return second;
    }
    return {
      state: "auth-expired",
      detail:
        "Anthropic API continued to reject the refreshed access token. " +
        ANTHROPIC_AUTH_REFRESH_HINT_MESSAGE,
      authExpiredUntil: Date.now() + DEFAULT_ANTHROPIC_AUTH_EXPIRED_BACKOFF_MS,
    };
  }
  return first;
}

function extractAuthBoolean(data: unknown): boolean | undefined {
  const record = asRecord(data);
  if (!record) {
    return undefined;
  }

  for (const candidate of [
    record["authenticated"],
    record["isAuthenticated"],
    record["loggedIn"],
  ]) {
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }

  const authRecord = asRecord(record["auth"]);
  if (authRecord) {
    for (const candidate of [authRecord["authenticated"], authRecord["loggedIn"]]) {
      if (typeof candidate === "boolean") {
        return candidate;
      }
    }
  }

  const status = record["status"];
  if (typeof status === "string") {
    const normalized = status.trim().toLowerCase();
    if (normalized === "authenticated") {
      return true;
    }
    if (normalized === "unauthenticated") {
      return false;
    }
  }

  return undefined;
}

function hasUnsupportedCommandText(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("unknown command") ||
    normalized.includes("unrecognized command") ||
    normalized.includes("unexpected argument")
  );
}

function hasUnauthenticatedText(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("not logged in") ||
    normalized.includes("login required") ||
    normalized.includes("authentication required") ||
    normalized.includes("run `claude login`") ||
    normalized.includes("run `claude auth login`") ||
    normalized.includes("run claude login") ||
    normalized.includes("run claude auth login")
  );
}

function detailFromCommandResult(result: ClaudeCommandResult): string | undefined {
  const detail = `${result.stderr}\n${result.stdout}\n${result.errorMessage ?? ""}`.trim();
  return detail ? sanitizeDisplaySnippet(detail, 160) : undefined;
}

function parseVersion(output: string): string | null {
  const match = output.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/);
  return match ? match[0] : null;
}

function isCommandMissing(result: ClaudeCommandResult): boolean {
  if (result.spawnErrorCode === "ENOENT") {
    return true;
  }

  const output = `${result.stderr}\n${result.stdout}\n${result.errorMessage ?? ""}`.toLowerCase();
  return (
    output.includes("command not found") ||
    output.includes("not recognized as an internal or external command") ||
    output.includes("no such file or directory")
  );
}

function isTimedOutError(error: Error & { code?: number | string; killed?: boolean }): boolean {
  return (
    error.code === "ETIMEDOUT" ||
    error.killed === true ||
    error.message.toLowerCase().includes("timed out")
  );
}

async function runClaudeCommand(invocation: ClaudeCommandInvocation): Promise<ClaudeCommandResult> {
  return await new Promise<ClaudeCommandResult>((resolve, reject) => {
    try {
      execFile(
        invocation.file,
        invocation.args,
        {
          encoding: "utf8",
          timeout: CLAUDE_COMMAND_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        },
        (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
          const stdoutText = typeof stdout === "string" ? stdout : stdout.toString("utf8");
          const stderrText = typeof stderr === "string" ? stderr : stderr.toString("utf8");

          if (!error) {
            resolve({
              code: 0,
              stdout: stdoutText,
              stderr: stderrText,
              timedOut: false,
            });
            return;
          }

          const execError = error as Error & { code?: number | string; killed?: boolean };
          resolve({
            code: typeof execError.code === "number" ? execError.code : null,
            stdout: stdoutText,
            stderr: stderrText,
            timedOut: isTimedOutError(execError),
            spawnErrorCode: execError.code,
            errorMessage: execError.message,
          });
        },
      );
    } catch (error) {
      reject(error);
    }
  });
}

function parseClaudeAuthStatusResult(result: ClaudeCommandResult): ParsedAuthProbe {
  const combinedOutput = `${result.stdout}\n${result.stderr}`;

  if (hasUnsupportedCommandText(combinedOutput)) {
    return {
      authStatus: "unknown",
      unsupportedCommand: true,
      message:
        "Claude CLI authentication status JSON is unavailable in this version of Claude.",
    };
  }

  if (hasUnauthenticatedText(combinedOutput)) {
    return {
      authStatus: "unauthenticated",
      message: "Claude is not authenticated. Run `claude auth login` and try again.",
    };
  }

  const trimmed = result.stdout.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const payload = JSON.parse(trimmed) as unknown;
      const auth = extractAuthBoolean(payload);

      if (auth === true) {
        return {
          authStatus: "authenticated",
          jsonPayload: payload,
        };
      }

      if (auth === false) {
        return {
          authStatus: "unauthenticated",
          message: "Claude is not authenticated. Run `claude auth login` and try again.",
          jsonPayload: payload,
        };
      }

      return {
        authStatus: "unknown",
        message: "Could not verify Claude authentication status from JSON output.",
        jsonPayload: payload,
      };
    } catch {
      // Fall through to exit-code-based handling.
    }
  }

  if (result.code === 0) {
    return { authStatus: "authenticated" };
  }

  if (result.timedOut) {
    return {
      authStatus: "unknown",
      message: "Timed out while running Claude CLI auth status.",
    };
  }

  const detail = detailFromCommandResult(result);
  return {
    authStatus: "unknown",
    message: detail
      ? `Could not verify Claude authentication status. ${detail}`
      : "Could not verify Claude authentication status.",
  };
}

function mapLocalDiagnosticsToAnthropicDiagnostics(
  localDiagnostics: AnthropicLocalDiagnostics,
): AnthropicDiagnostics {
  if (localDiagnostics.localStatus) {
    return {
      installed: localDiagnostics.installed,
      version: localDiagnostics.version,
      authStatus: localDiagnostics.authStatus,
      statusSupported: true,
      statusSource: "claude-auth-status-json",
      checkedCommands: localDiagnostics.checkedCommands,
      status: localDiagnostics.localStatus,
    };
  }

  const diagnostics: AnthropicDiagnostics = {
    installed: localDiagnostics.installed,
    version: localDiagnostics.version,
    authStatus: localDiagnostics.authStatus,
    statusSupported: false,
    statusSource: "none",
    checkedCommands: localDiagnostics.checkedCommands,
  };

  if (localDiagnostics.message) {
    diagnostics.message = localDiagnostics.message;
  }

  return diagnostics;
}

async function probeAnthropicLocalDiagnostics(
  options: AnthropicProbeOptions = {},
): Promise<AnthropicLocalDiagnostics> {
  const binaryPath = resolveAnthropicBinaryPath(options.binaryPath);
  const checkedCommands: string[] = [];

  const versionCommand = buildClaudeCommandInvocation(binaryPath, ["--version"]);
  checkedCommands.push(versionCommand.display);
  const versionResult = await runClaudeCommand(versionCommand);
  if (isCommandMissing(versionResult)) {
    return {
      installed: false,
      version: null,
      authStatus: "unknown",
      checkedCommands,
      message: `Claude CLI (\`${sanitizeDisplayText(binaryPath)}\`) is not installed or not on PATH.`,
    };
  }

  const version = parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`);

  const authStatusJsonCommand = buildClaudeCommandInvocation(binaryPath, [
    "auth",
    "status",
    "--json",
  ]);
  checkedCommands.push(authStatusJsonCommand.display);
  const authJsonResult = await runClaudeCommand(authStatusJsonCommand);
  let parsedAuth = parseClaudeAuthStatusResult(authJsonResult);

  if (parsedAuth.unsupportedCommand) {
    const authStatusCommand = buildClaudeCommandInvocation(binaryPath, ["auth", "status"]);
    checkedCommands.push(authStatusCommand.display);
    parsedAuth = parseClaudeAuthStatusResult(await runClaudeCommand(authStatusCommand));
  }

  if (parsedAuth.authStatus !== "authenticated") {
    return {
      installed: true,
      version,
      authStatus: parsedAuth.authStatus,
      checkedCommands,
      message: parsedAuth.message,
    };
  }

  const status = parsedAuth.jsonPayload ? parseUsageResponse(parsedAuth.jsonPayload) : null;
  if (status) {
    return {
      installed: true,
      version,
      authStatus: "authenticated",
      checkedCommands,
      localStatus: status,
    };
  }

  return {
    installed: true,
    version,
    authStatus: "authenticated",
    checkedCommands,
    message: CLAUDE_NO_LOCAL_STATUS_MESSAGE,
  };
}

export function clearAnthropicDiagnosticsCacheForTests(): void {
  diagnosticsCache.clear();
  localDiagnosticsCache.clear();
}

async function getCachedAnthropicLocalDiagnostics(
  options: AnthropicProbeOptions = {},
): Promise<AnthropicLocalDiagnostics> {
  const binaryPath = resolveAnthropicBinaryPath(options.binaryPath);
  const now = Date.now();
  const cached = localDiagnosticsCache.get(binaryPath) ?? {
    timestamp: 0,
    value: null,
  };

  if (
    cached.value &&
    cached.timestamp > 0 &&
    now - cached.timestamp < ANTHROPIC_DIAGNOSTICS_TTL_MS
  ) {
    return cached.value;
  }

  if (cached.inFlight) {
    return cached.inFlight;
  }

  const inFlight = probeAnthropicLocalDiagnostics({ binaryPath }).then((value) => {
    localDiagnosticsCache.set(binaryPath, {
      timestamp: Date.now(),
      value,
    });
    return value;
  });

  localDiagnosticsCache.set(binaryPath, {
    timestamp: cached.timestamp,
    value: cached.value,
    inFlight,
  });

  try {
    return await inFlight;
  } finally {
    const latest = localDiagnosticsCache.get(binaryPath);
    if (latest?.inFlight === inFlight) {
      localDiagnosticsCache.set(binaryPath, {
        timestamp: latest.timestamp,
        value: latest.value,
      });
    }
  }
}

export async function getAnthropicDiagnostics(
  options: AnthropicProbeOptions = {},
): Promise<AnthropicDiagnostics> {
  const binaryPath = resolveAnthropicBinaryPath(options.binaryPath);
  const now = Date.now();
  const cached = diagnosticsCache.get(binaryPath) ?? {
    timestamp: 0,
    value: null,
  };

  if (
    cached.value &&
    cached.timestamp > 0 &&
    now - cached.timestamp < ANTHROPIC_DIAGNOSTICS_TTL_MS
  ) {
    return cached.value;
  }

  if (cached.inFlight) {
    return cached.inFlight;
  }

  const inFlight = (async () => {
    const localDiagnostics = await getCachedAnthropicLocalDiagnostics({ binaryPath });
    if (localDiagnostics.localStatus) {
      return mapLocalDiagnosticsToAnthropicDiagnostics(localDiagnostics);
    }

    const credentials = await readClaudeCredentialsAccessToken();
    if (credentials.state !== "configured") {
      if (localDiagnostics.authStatus !== "authenticated") {
        return mapLocalDiagnosticsToAnthropicDiagnostics(localDiagnostics);
      }

      const diagnostics: AnthropicDiagnostics = {
        installed: localDiagnostics.installed,
        version: localDiagnostics.version,
        authStatus: localDiagnostics.authStatus,
        statusSupported: false,
        statusSource: "none",
        checkedCommands: localDiagnostics.checkedCommands,
        message: buildAnthropicNoStatusDiagnosticsMessage(credentials.detail),
      };
      return diagnostics;
    }

    const fallbackStatus = await queryAnthropicUsageEndpointWithRefresh(
      credentials.accessToken,
      options.requestTimeoutMs,
    );
    if (fallbackStatus.state === "rate-limited") {
      const diagnostics: AnthropicDiagnostics = {
        installed: localDiagnostics.installed,
        version: localDiagnostics.version,
        authStatus: localDiagnostics.authStatus,
        statusSupported: false,
        statusSource: "rate-limited",
        rateLimitedUntil: fallbackStatus.rateLimitedUntil,
        checkedCommands: localDiagnostics.checkedCommands,
        message: fallbackStatus.detail,
      };
      return diagnostics;
    }
    if (fallbackStatus.state === "auth-expired") {
      const diagnostics: AnthropicDiagnostics = {
        installed: localDiagnostics.installed,
        version: localDiagnostics.version,
        authStatus: localDiagnostics.authStatus,
        statusSupported: false,
        statusSource: "auth-expired",
        authExpiredUntil: fallbackStatus.authExpiredUntil,
        checkedCommands: localDiagnostics.checkedCommands,
        message: buildAnthropicNoStatusDiagnosticsMessage(fallbackStatus.detail),
      };
      return diagnostics;
    }
    if (fallbackStatus.state !== "success") {
      const diagnostics: AnthropicDiagnostics = {
        installed: localDiagnostics.installed,
        version: localDiagnostics.version,
        authStatus: localDiagnostics.authStatus,
        statusSupported: false,
        statusSource: "none",
        checkedCommands: localDiagnostics.checkedCommands,
        message: buildAnthropicNoStatusDiagnosticsMessage(fallbackStatus.detail),
      };
      return diagnostics;
    }

    const diagnostics: AnthropicDiagnostics = {
      installed: localDiagnostics.installed,
      version: localDiagnostics.version,
      authStatus: "authenticated",
      statusSupported: true,
      statusSource: "claude-credentials-oauth-api",
      checkedCommands: localDiagnostics.checkedCommands,
      status: fallbackStatus.status,
    };
    return diagnostics;
  })().then((value) => {
    diagnosticsCache.set(binaryPath, {
      timestamp: Date.now(),
      value,
    });
    return value;
  });

  diagnosticsCache.set(binaryPath, {
    timestamp: cached.timestamp,
    value: cached.value,
    inFlight,
  });

  try {
    return await inFlight;
  } finally {
    const latest = diagnosticsCache.get(binaryPath);
    if (latest?.inFlight === inFlight) {
      diagnosticsCache.set(binaryPath, {
        timestamp: latest.timestamp,
        value: latest.value,
      });
    }
  }
}

export async function hasAnthropicCredentialsConfigured(
  options: AnthropicProbeOptions = {},
): Promise<boolean> {
  // Fast path: check OpenCode `auth.json` for a valid OAuth access token.
  // This avoids spawning `claude --version` on every provider-availability
  // check, which would otherwise make the Anthropic status provider look
  // unavailable whenever the Claude Code CLI is not already running in
  // another terminal. The auth.json entry is written by companion plugins
  // (such as the absorbed `opencode-anthropic-login-via-cli`) and is the
  // canonical source for OAuth credentials on this fork.
  //
  // Bug: an OAuth entry that is present but locally expired used to be
  // treated the same as "no credentials" here, even though
  // readClaudeCredentialsAccessTokenFromOpencodeAuth() already knows how to
  // refresh exactly that state. That mismatch made isAvailable() report
  // "Unavailable (not detected)" for accounts that were actually valid and
  // refreshable (see bugfix/status-provider-anthropic-token-refresh).
  try {
    const credentials = await readClaudeCredentialsAccessTokenFromOpencodeAuth();
    if (credentials.state === "configured") {
      return true;
    }
  } catch {
    // fall through to CLI probe
  }

  // Slow path: probe the local Claude CLI to detect auth sourced from
  // `~/.claude/.credentials.json` or the macOS Keychain when auth.json has
  // no entry (or has a stale/expired one we couldn't refresh).
  try {
    const diagnostics = await getCachedAnthropicLocalDiagnostics(options);
    return diagnostics.installed && diagnostics.authStatus === "authenticated";
  } catch {
    return false;
  }
}

export async function queryAnthropicStatus(
  options: AnthropicProbeOptions = {},
): Promise<AnthropicResult> {
  try {
    const diagnostics = await getAnthropicDiagnostics(options);
    if (diagnostics.statusSupported) {
      return diagnostics.status ?? null;
    }

    if (
      diagnostics.statusSource === "rate-limited" &&
      typeof diagnostics.rateLimitedUntil === "number"
    ) {
      return {
        success: false,
        error: diagnostics.message ?? "Anthropic API rate-limited (429)",
        rateLimitedUntil: diagnostics.rateLimitedUntil,
      };
    }

    if (diagnostics.statusSource === "auth-expired" && typeof diagnostics.authExpiredUntil === "number") {
      return {
        success: false,
        error: diagnostics.message ?? "Anthropic OAuth token expired",
        authExpiredUntil: diagnostics.authExpiredUntil,
      };
    }

    if (diagnostics.authStatus === "authenticated" && diagnostics.message) {
      return {
        success: false,
        error: diagnostics.message,
      };
    }

    return null;
  } catch (err) {
    return {
      success: false,
      error: `Claude CLI probe failed: ${sanitizeDisplayText(
        err instanceof Error ? err.message : String(err),
      )}`,
    };
  }
}

export { parseUsageResponse };
