/**
 * OpenAI (ChatGPT) status fetcher
 *
 * Uses OpenCode's auth.json native OpenCode OAuth entries and queries:
 * https://chatgpt.com/backend-api/wham/usage
 */

import type { AuthData, OpenAIOAuthData, StatusError } from "./types.js";
import { sanitizeDisplaySnippet, sanitizeDisplayText } from "./display-sanitize.js";
import { fetchWithTimeout } from "./http.js";
import { invalidateAuthFileCache, readAuthFileCached } from "./opencode-auth.js";
import { clampPercent } from "./format-utils.js";

interface RateLimitWindow {
  used_percent: number;
  limit_window_seconds: number;
  reset_after_seconds: number;
  reset_at?: number;
}

interface OpenAIUsageResponse {
  plan_type: string;
  rate_limit: {
    limit_reached: boolean;
    primary_window: RateLimitWindow;
    secondary_window: RateLimitWindow | null;
  } | null;
  code_review_rate_limit?: {
    primary_window: RateLimitWindow | null;
  } | null;
  credits?: {
    has_credits: boolean;
    unlimited: boolean;
    balance: string | null;
  } | null;
}

interface JwtPayload {
  "https://api.openai.com/profile"?: {
    email?: string;
  };
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padLen);
  return Buffer.from(padded, "base64").toString("utf8");
}

function parseJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(base64UrlDecode(parts[1])) as JwtPayload;
  } catch {
    return null;
  }
}

function getEmailFromJwt(token: string): string | null {
  return parseJwt(token)?.["https://api.openai.com/profile"]?.email ?? null;
}

function getAccountIdFromJwt(token: string): string | null {
  return parseJwt(token)?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? null;
}

function remainingPercent(window: RateLimitWindow): number {
  return clampPercent(100 - window.used_percent);
}

function resetIsoFromNowSeconds(seconds: number): string | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(Date.now() + Math.round(seconds * 1000)).toISOString();
}

function resetIsoFromResetAt(resetAt?: number): string | undefined {
  if (!Number.isFinite(resetAt) || !resetAt) return undefined;
  const ms = Math.round(resetAt * 1000);
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return new Date(ms).toISOString();
}

function derivePlanLabel(planType: string | undefined): string {
  const raw = (planType ?? "").toLowerCase();
  if (raw.includes("pro")) return "OpenAI (Pro)";
  if (raw.includes("plus")) return "OpenAI (Plus)";
  if (planType) return `OpenAI (${planType})`;
  return "OpenAI";
}

const OPENAI_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const DEFAULT_OPENAI_AUTH_CACHE_MAX_AGE_MS = 5_000;
export const OPENAI_AUTH_SOURCE_KEYS = ["openai", "codex", "chatgpt", "opencode"] as const;

export type OpenAIAuthSourceKey = (typeof OPENAI_AUTH_SOURCE_KEYS)[number];

export type OpenAIResult =
  | {
      success: true;
      label: string;
      email?: string;
      windows: {
        hourly?: { percentRemaining: number; resetTimeIso?: string };
        weekly?: { percentRemaining: number; resetTimeIso?: string };
        codeReview?: { percentRemaining: number; resetTimeIso?: string };
      };
      credits?: {
        hasCredits: boolean;
        unlimited: boolean;
        balance: string | null;
      };
    }
  | StatusError
  | null;

export type ResolvedOpenAIOAuth =
  | { state: "none" }
  | {
      state: "configured";
      sourceKey: OpenAIAuthSourceKey;
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      email?: string;
      accountId?: string;
    };

function getOpenAIOAuthEntry(
  auth: AuthData | null | undefined,
): { sourceKey: OpenAIAuthSourceKey; entry: OpenAIOAuthData; accessToken: string } | null {
  for (const sourceKey of OPENAI_AUTH_SOURCE_KEYS) {
    const entry = auth?.[sourceKey];
    if (!entry || entry.type !== "oauth") {
      continue;
    }

    const accessToken = typeof entry.access === "string" ? entry.access.trim() : "";
    if (accessToken) {
      return { sourceKey, entry, accessToken };
    }
  }

  return null;
}

export function resolveOpenAIOAuth(auth: AuthData | null | undefined): ResolvedOpenAIOAuth {
  const resolved = getOpenAIOAuthEntry(auth);
  if (!resolved) {
    return { state: "none" };
  }

  const email = getEmailFromJwt(resolved.accessToken) ?? undefined;
  const accountId = getAccountIdFromJwt(resolved.accessToken) ?? resolved.entry.accountId ?? undefined;

  return {
    state: "configured",
    sourceKey: resolved.sourceKey,
    accessToken: resolved.accessToken,
    refreshToken:
      typeof resolved.entry.refresh === "string" && resolved.entry.refresh.trim()
        ? resolved.entry.refresh
        : undefined,
    expiresAt: typeof resolved.entry.expires === "number" ? resolved.entry.expires : undefined,
    email,
    accountId,
  };
}

export function hasOpenAIOAuth(auth: AuthData | null | undefined): boolean {
  return resolveOpenAIOAuth(auth).state === "configured";
}

export async function hasOpenAIOAuthCached(params?: {
  maxAgeMs?: number;
}): Promise<boolean> {
  const auth = await readAuthFileCached({
    maxAgeMs: Math.max(0, params?.maxAgeMs ?? DEFAULT_OPENAI_AUTH_CACHE_MAX_AGE_MS),
  });
  return hasOpenAIOAuth(auth);
}

type ConfiguredOpenAIOAuth = Extract<ResolvedOpenAIOAuth, { state: "configured" }>;

type OpenAIUsageFetchOutcome =
  | { kind: "success"; result: Extract<OpenAIResult, { success: true }> }
  | { kind: "no-data" }
  | { kind: "auth-error"; status: number; text: string }
  | { kind: "http-error"; status: number; text: string }
  | { kind: "network-error"; message: string };

async function fetchOpenAIUsage(
  resolvedAuth: ConfiguredOpenAIOAuth,
  requestTimeoutMs?: number,
): Promise<OpenAIUsageFetchOutcome> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${resolvedAuth.accessToken}`,
      "User-Agent": "OpenCode-Status-Toast/1.0",
    };

    const accountId = resolvedAuth.accountId;
    if (accountId) {
      headers["ChatGPT-Account-Id"] = accountId;
    }

    const resp = await fetchWithTimeout(OPENAI_USAGE_URL, { headers }, requestTimeoutMs);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      if (resp.status === 401 || resp.status === 403) {
        return { kind: "auth-error", status: resp.status, text };
      }
      return { kind: "http-error", status: resp.status, text };
    }

    const data = (await resp.json()) as OpenAIUsageResponse;
    const primary = data.rate_limit?.primary_window;
    const secondary = data.rate_limit?.secondary_window ?? null;
    const codeReview = data.code_review_rate_limit?.primary_window ?? null;
    const credits = data.credits ?? null;

    if (!primary) return { kind: "no-data" };

    const hourlyRemain = remainingPercent(primary);
    const weeklyRemain = secondary ? remainingPercent(secondary) : undefined;
    const codeReviewRemain = codeReview ? remainingPercent(codeReview) : undefined;

    const hourlyResetIso =
      resetIsoFromResetAt(primary.reset_at) ?? resetIsoFromNowSeconds(primary.reset_after_seconds);
    const weeklyResetIso = secondary
      ? (resetIsoFromResetAt(secondary.reset_at) ??
        resetIsoFromNowSeconds(secondary.reset_after_seconds))
      : undefined;
    const codeReviewResetIso = codeReview
      ? (resetIsoFromResetAt(codeReview.reset_at) ??
        resetIsoFromNowSeconds(codeReview.reset_after_seconds))
      : undefined;

    return {
      kind: "success",
      result: {
        success: true,
        label: derivePlanLabel(data.plan_type),
        email: resolvedAuth.email,
        windows: {
          hourly: { percentRemaining: clampPercent(hourlyRemain), resetTimeIso: hourlyResetIso },
          weekly:
            weeklyRemain === undefined
              ? undefined
              : { percentRemaining: clampPercent(weeklyRemain), resetTimeIso: weeklyResetIso },
          codeReview:
            codeReviewRemain === undefined
              ? undefined
              : {
                  percentRemaining: clampPercent(codeReviewRemain),
                  resetTimeIso: codeReviewResetIso,
                },
        },
        credits: credits
          ? {
              hasCredits: Boolean(credits.has_credits),
              unlimited: Boolean(credits.unlimited),
              balance: credits.balance ?? null,
            }
          : undefined,
      },
    };
  } catch (err) {
    return {
      kind: "network-error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Re-read auth.json once, bypassing the short-lived cache, to pick up a
 * token that may have already been rotated on disk by OpenCode itself (or
 * another process) without us seeing it yet. status-fork does not own the
 * OpenAI/ChatGPT OAuth refresh flow — unlike Anthropic, there is no
 * refresh_token exchange implemented here — so an opportunistic re-read is
 * the safe way to recover instead of reporting a hard failure for a token
 * that may already be fresh on disk.
 */
async function reReadOpenAIOAuth(): Promise<ConfiguredOpenAIOAuth | null> {
  invalidateAuthFileCache();
  const freshAuth = await readAuthFileCached({ maxAgeMs: 0 });
  const freshResolved = resolveOpenAIOAuth(freshAuth);
  if (
    freshResolved.state === "configured" &&
    (!freshResolved.expiresAt || freshResolved.expiresAt >= Date.now())
  ) {
    return freshResolved;
  }
  return null;
}

export async function queryOpenAIStatus(options: { requestTimeoutMs?: number } = {}): Promise<OpenAIResult> {
  const auth = await readAuthFileCached({
    maxAgeMs: DEFAULT_OPENAI_AUTH_CACHE_MAX_AGE_MS,
  });
  let resolvedAuth = resolveOpenAIOAuth(auth);
  if (resolvedAuth.state !== "configured") return null;

  if (resolvedAuth.expiresAt && resolvedAuth.expiresAt < Date.now()) {
    const fresh = await reReadOpenAIOAuth();
    if (!fresh) {
      // Locally expired and nothing fresher on disk yet — this is expected
      // to self-heal once OpenCode's own ChatGPT login rotates the token,
      // so mark it retryable instead of a hard failure.
      return { success: false, error: "Token expired", retryable: true };
    }
    resolvedAuth = fresh;
  }

  const outcome = await fetchOpenAIUsage(resolvedAuth, options.requestTimeoutMs);

  if (outcome.kind === "success") {
    return outcome.result;
  }

  if (outcome.kind === "no-data") {
    return { success: false, error: "No status data" };
  }

  if (outcome.kind === "network-error") {
    return { success: false, error: sanitizeDisplayText(outcome.message) };
  }

  if (outcome.kind === "auth-error") {
    // Mirrors the Anthropic provider's opportunistic-retry pattern: a
    // locally valid-looking token can still be rejected remotely. Re-check
    // auth.json once for a rotated token before giving up.
    const fresh = await reReadOpenAIOAuth();
    if (fresh && fresh.accessToken !== resolvedAuth.accessToken) {
      const retryOutcome = await fetchOpenAIUsage(fresh, options.requestTimeoutMs);
      if (retryOutcome.kind === "success") {
        return retryOutcome.result;
      }
    }

    return {
      success: false,
      error: `OpenAI API error ${outcome.status}: ${sanitizeDisplaySnippet(outcome.text, 120)}`,
      retryable: true,
    };
  }

  // Generic (non-auth) HTTP error — not treated as a self-healing auth state.
  return {
    success: false,
    error: `OpenAI API error ${outcome.status}: ${sanitizeDisplaySnippet(outcome.text, 120)}`,
  };
}
