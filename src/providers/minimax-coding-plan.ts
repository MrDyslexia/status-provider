/**
 * MiniMax Coding Plan provider wrapper.
 *
 * Fetches status data from MiniMax API for coding plan users.
 */

import type {
  StatusProvider,
  StatusProviderContext,
  StatusProviderMatchContext,
  StatusProviderResult,
} from "../lib/entries.js";
import {
  DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS,
  resolveMiniMaxAuthCached,
  resolveMiniMaxChinaAuthCached,
  type ResolvedMiniMaxAuth,
} from "../lib/minimax-auth.js";
import {
  getMiniMaxStatusEndpoint,
  type MiniMaxStatusEndpointId,
} from "../lib/minimax-endpoints.js";
import { sanitizeDisplayText } from "../lib/display-sanitize.js";
import { fetchWithTimeout } from "../lib/http.js";
import {
  isAnyProviderIdAvailable,
  isCanonicalProviderAvailable,
} from "../lib/provider-availability.js";
import { normalizeStatusProviderId } from "../lib/provider-metadata.js";
import type { MiniMaxResult, MiniMaxResultEntry } from "../lib/types.js";
import { attemptedErrorResult, attemptedResult, notAttemptedResult } from "./result-helpers.js";

const MINIMAX_PROVIDER_LABEL = "MiniMax Coding Plan";
const MINIMAX_CHINA_PROVIDER_LABEL = "MiniMax Coding Plan (CN)";
const USER_AGENT = "OpenCode-Status-Toast/1.0";

/**
 * Parsing mode for the MiniMax status response.
 *
 * - `percent`: the international Token Plan endpoint (`www.minimax.io/v1/token_plan/remains`)
 *   returns `current_interval_remaining_percent` / `current_weekly_remaining_percent`
 *   directly. This is the unified status, scoped to `model_name: "general"`.
 * - `count-used`: the China Token Plan endpoint (`api.minimaxi.com/v1/token_plan/remains`)
 *   still returns count semantics where `current_interval_usage_count` and
 *   `current_weekly_usage_count` represent *used* tokens (not remaining).
 */
type MiniMaxParsingMode = "percent" | "count-used";

const MINIMAX_PARSING_MODE_BY_ENDPOINT: Record<MiniMaxStatusEndpointId, MiniMaxParsingMode> = {
  international: "percent",
  china: "count-used",
};

interface MiniMaxModelRemain {
  model_name: string;

  // Percent-mode fields (international Token Plan)
  current_interval_remaining_percent?: number;
  current_weekly_remaining_percent?: number;

  // Count-mode fields (China Token Plan: total + used)
  current_interval_total_count?: number;
  current_interval_usage_count?: number;
  current_weekly_total_count?: number;
  current_weekly_usage_count?: number;

  // Common
  remains_time: number;
  weekly_remains_time?: number;
}

interface MiniMaxApiResponse {
  model_remains: MiniMaxModelRemain[];
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

interface MiniMaxWindowSpec {
  mode: MiniMaxParsingMode;
  window: MiniMaxResultEntry["window"];
  name: string;
  label: string;
  getResetOffsetMs(model: MiniMaxModelRemain): number | undefined;
  getPercent?(model: MiniMaxModelRemain): number | undefined;
  getTotal?(model: MiniMaxModelRemain): number | undefined;
  getCount?(model: MiniMaxModelRemain): number | undefined;
}

const MINIMAX_WINDOW_SPECS: readonly MiniMaxWindowSpec[] = [
  // Percent-mode (international Token Plan)
  {
    mode: "percent",
    window: "five_hour",
    name: "MiniMax Coding Plan 5h",
    label: "5h:",
    getPercent: (model) => model.current_interval_remaining_percent,
    getResetOffsetMs: (model) => model.remains_time,
  },
  {
    mode: "percent",
    window: "weekly",
    name: "MiniMax Coding Plan Weekly",
    label: "Weekly:",
    getPercent: (model) => model.current_weekly_remaining_percent,
    getResetOffsetMs: (model) => model.weekly_remains_time,
  },
  // Count-mode (China Token Plan)
  {
    mode: "count-used",
    window: "five_hour",
    name: "MiniMax Coding Plan 5h",
    label: "5h:",
    getTotal: (model) => model.current_interval_total_count,
    getCount: (model) => model.current_interval_usage_count,
    getResetOffsetMs: (model) => model.remains_time,
  },
  {
    mode: "count-used",
    window: "weekly",
    name: "MiniMax Coding Plan Weekly",
    label: "Weekly:",
    getTotal: (model) => model.current_weekly_total_count,
    getCount: (model) => model.current_weekly_usage_count,
    getResetOffsetMs: (model) => model.weekly_remains_time,
  },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Type guard that validates a value is a well-formed MiniMax model record for
 * the given parsing mode.
 *
 * - `percent` mode: requires `model_name`, `current_interval_remaining_percent`,
 *   and `remains_time`. The count fields may be absent.
 * - `count-used` mode: requires the count fields and `remains_time`.
 */
function isMiniMaxModelRecordForMode(
  value: unknown,
  mode: MiniMaxParsingMode,
): value is MiniMaxModelRemain {
  if (value === null || typeof value !== "object" || !("model_name" in value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.model_name !== "string" || !isFiniteNumber(v.remains_time)) return false;

  if (mode === "percent") {
    return isFiniteNumber(v.current_interval_remaining_percent);
  }

  return (
    isFiniteNumber(v.current_interval_total_count) &&
    isFiniteNumber(v.current_interval_usage_count)
  );
}

function roundPercent(value: number): number {
  return Math.min(100, Math.round(value));
}

function sanitizeMiniMaxMessage(text: string, maxLength = 120): string {
  const sanitized = sanitizeDisplayText(text).replace(/\s+/g, " ").trim();
  return (sanitized || "unknown").slice(0, maxLength);
}

/**
 * Match a model name against the canonical naming conventions for MiniMax status.
 *
 * - `general`: the unified status scope in the international Token Plan
 * - `minimax-m*`: legacy wildcard used by Coding Plan
 * - any name starting with `minimax-m`: a specific MiniMax-M* text model
 */
function isMiniMaxCodingModelName(modelName: string): boolean {
  const normalized = modelName.trim().toLowerCase();
  return (
    normalized === "general" ||
    normalized === "minimax-m*" ||
    normalized.startsWith("minimax-m")
  );
}

function buildMiniMaxEntry(
  model: MiniMaxModelRemain,
  spec: MiniMaxWindowSpec,
  providerLabel: string,
): MiniMaxResultEntry | null {
  const resetOffsetMs = spec.getResetOffsetMs(model);
  if (!isFiniteNumber(resetOffsetMs)) return null;

  let percentRemaining: number;
  let right: string | undefined;

  if (spec.mode === "percent" && spec.getPercent) {
    const percent = spec.getPercent(model);
    if (!isFiniteNumber(percent)) return null;
    percentRemaining = roundPercent(percent);
  } else if (spec.mode === "count-used" && spec.getTotal && spec.getCount) {
    const total = spec.getTotal(model);
    const used = spec.getCount(model);
    if (!isFiniteNumber(total) || !isFiniteNumber(used)) return null;
    if (total <= 0) return null;
    // Allow negative remaining (over-status) so the UI can show "exceeded"
    // rather than flooring at 0%. roundPercent preserves negative values.
    const remaining = total - used;
    percentRemaining = roundPercent((remaining / total) * 100);
    right = `${used}/${total}`;
  } else {
    return null;
  }

  return {
    window: spec.window,
    name: spec.name.replace(MINIMAX_PROVIDER_LABEL, providerLabel),
    group: providerLabel,
    label: spec.label,
    ...(right ? { right } : {}),
    percentRemaining,
    resetTimeIso: new Date(Date.now() + Math.max(0, resetOffsetMs)).toISOString(),
  };
}

function buildMiniMaxEntries(
  model: MiniMaxModelRemain,
  providerLabel: string,
  mode: MiniMaxParsingMode,
): MiniMaxResultEntry[] {
  return MINIMAX_WINDOW_SPECS.filter((spec) => spec.mode === mode).flatMap((spec) => {
    const entry = buildMiniMaxEntry(model, spec, providerLabel);
    return entry ? [entry] : [];
  });
}

function getWorstPercent(
  model: MiniMaxModelRemain,
  mode: MiniMaxParsingMode,
): number {
  const percents = buildMiniMaxEntries(model, MINIMAX_PROVIDER_LABEL, mode).map(
    (entry) => entry.percentRemaining,
  );
  return percents.length > 0 ? Math.min(...percents) : Number.POSITIVE_INFINITY;
}

function selectCanonicalMiniMaxModel(
  models: MiniMaxModelRemain[],
  mode: MiniMaxParsingMode,
): MiniMaxModelRemain | null {
  if (models.length === 0) return null;

  // Prefer the canonical scope name for the parsing mode.
  const preferredNames = mode === "percent" ? ["general"] : ["minimax-m*"];
  for (const preferred of preferredNames) {
    const candidate = models.find(
      (model) => model.model_name.trim().toLowerCase() === preferred,
    );
    if (candidate && Number.isFinite(getWorstPercent(candidate, mode))) {
      return candidate;
    }
  }

  return [...models].sort((left, right) => {
    const percentDiff = getWorstPercent(left, mode) - getWorstPercent(right, mode);
    if (percentDiff !== 0) return percentDiff;
    return left.model_name.localeCompare(right.model_name);
  })[0] ?? null;
}

/**
 * Fetch MiniMax coding plan status from the API.
 *
 * Parses usage for the international Token Plan (`percent` mode, model name
 * `general`) or the China Token Plan (`count-used` mode, model name `minimax-m*`).
 *
 * @param apiKey - MiniMax API key
 * @returns Status entries on success, error on failure, or empty entries when
 *          the API returns successfully but no models have reportable status.
 */
export async function queryMiniMaxStatus(
  apiKey: string,
  options: { requestTimeoutMs?: number; endpoint?: MiniMaxStatusEndpointId; label?: string } = {},
): Promise<MiniMaxResult> {
  const endpointId = options.endpoint ?? "international";
  const endpoint = getMiniMaxStatusEndpoint(endpointId);
  const mode = MINIMAX_PARSING_MODE_BY_ENDPOINT[endpointId];
  try {
    const response = await fetchWithTimeout(
      endpoint.statusUrl,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": USER_AGENT,
        },
      },
      options.requestTimeoutMs,
    );

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: `MiniMax API error ${response.status}: ${sanitizeMiniMaxMessage(text, 120)}`,
      };
    }

    const payload = (await response.json()) as MiniMaxApiResponse;

    if (payload.base_resp?.status_code !== 0) {
      return {
        success: false,
        error: `MiniMax API error: ${sanitizeMiniMaxMessage(payload.base_resp?.status_msg ?? "unknown")}`,
      };
    }

    const matchingModels = (payload.model_remains ?? []).filter(
      (model): model is MiniMaxModelRemain =>
        isMiniMaxModelRecordForMode(model, mode) && isMiniMaxCodingModelName(model.model_name),
    );
    const canonicalModel = selectCanonicalMiniMaxModel(matchingModels, mode);
    const entries = canonicalModel
      ? buildMiniMaxEntries(canonicalModel, options.label ?? MINIMAX_PROVIDER_LABEL, mode)
      : [];

    return { success: true, entries };
  } catch (err) {
    return {
      success: false,
      error: sanitizeMiniMaxMessage(err instanceof Error ? err.message : String(err)),
    };
  }
}

type MiniMaxProviderSpec = {
  id: "minimax-coding-plan" | "minimax-china-coding-plan";
  label: string;
  endpoint: MiniMaxStatusEndpointId;
  resolveAuthCached: (params?: { maxAgeMs?: number }) => Promise<ResolvedMiniMaxAuth>;
};

function isMiniMaxChinaExplicitlyEnabled(context?: StatusProviderMatchContext): boolean {
  if (!context || context.enabledProviders === "auto") return false;
  return context.enabledProviders.some(
    (providerId) => normalizeStatusProviderId(providerId) === "minimax-china-coding-plan",
  );
}

function matchesMiniMaxCurrentModel(
  model: string,
  spec: MiniMaxProviderSpec,
  context?: StatusProviderMatchContext,
): boolean {
  const [provider = "", modelId] = model.toLowerCase().split("/", 2);
  if (!modelId || !isMiniMaxCodingModelName(modelId)) return false;

  const normalizedProvider = normalizeStatusProviderId(provider);
  if (spec.id === "minimax-coding-plan") {
    return normalizedProvider === "minimax-coding-plan";
  }

  return (
    normalizedProvider === "minimax-china-coding-plan" ||
    (provider === "minimax" && isMiniMaxChinaExplicitlyEnabled(context))
  );
}

async function isMiniMaxProviderRuntimeAvailable(
  ctx: StatusProviderContext,
  spec: MiniMaxProviderSpec,
): Promise<boolean> {
  const providerAvailable = await isCanonicalProviderAvailable({
    ctx,
    providerId: spec.id,
    fallbackOnError: false,
  });
  if (providerAvailable) return true;

  if (spec.id !== "minimax-china-coding-plan" || !isMiniMaxChinaExplicitlyEnabled(ctx.config)) {
    return false;
  }

  return isAnyProviderIdAvailable({
    ctx,
    candidateIds: ["minimax"],
    fallbackOnError: false,
  });
}

function createMiniMaxProvider(spec: MiniMaxProviderSpec): StatusProvider {
  return {
    id: spec.id,

    async isAvailable(ctx: StatusProviderContext): Promise<boolean> {
      const providerAvailable = await isMiniMaxProviderRuntimeAvailable(ctx, spec);
      if (!providerAvailable) {
        return false;
      }

      const auth = await spec.resolveAuthCached({
        maxAgeMs: DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS,
      });
      return auth.state === "configured" || auth.state === "invalid";
    },

    matchesCurrentModel(model: string, context?: StatusProviderMatchContext): boolean {
      return matchesMiniMaxCurrentModel(model, spec, context);
    },

    async fetch(ctx: StatusProviderContext): Promise<StatusProviderResult> {
      const auth = await spec.resolveAuthCached({
        maxAgeMs: DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS,
      });

      if (auth.state === "none") {
        return notAttemptedResult();
      }

      if (auth.state === "invalid") {
        return attemptedErrorResult(spec.label, auth.error);
      }

      const result = await queryMiniMaxStatus(auth.apiKey, {
        endpoint: spec.endpoint,
        label: spec.label,
        requestTimeoutMs: ctx.config?.requestTimeoutMs,
      });

      if (!result.success) {
        return attemptedErrorResult(spec.label, result.error);
      }

      return attemptedResult(result.entries);
    },
  };
}

export const minimaxCodingPlanProvider: StatusProvider = createMiniMaxProvider({
  id: "minimax-coding-plan",
  label: MINIMAX_PROVIDER_LABEL,
  endpoint: "international",
  resolveAuthCached: resolveMiniMaxAuthCached,
});

export const minimaxChinaCodingPlanProvider: StatusProvider = createMiniMaxProvider({
  id: "minimax-china-coding-plan",
  label: MINIMAX_CHINA_PROVIDER_LABEL,
  endpoint: "china",
  resolveAuthCached: resolveMiniMaxChinaAuthCached,
});
