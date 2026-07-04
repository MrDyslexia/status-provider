import type {
  StatusProviderPresentation,
  StatusProviderResult,
  StatusProviderEntry,
  StatusProviderError,
} from "../lib/entries.js";

export function notAttemptedResult(): StatusProviderResult {
  return { attempted: false, entries: [], errors: [] };
}

export function attemptedResult(
  entries: StatusProviderEntry[],
  errors: StatusProviderError[] = [],
  presentation?: StatusProviderPresentation,
): StatusProviderResult {
  return {
    attempted: true,
    entries,
    errors,
    ...(presentation ? { presentation } : {}),
  };
}

export function attemptedErrorResult(label: string, message: string): StatusProviderResult {
  return attemptedResult([], [{ label, message }]);
}

/**
 * Build an attempted result that also marks the provider as rate-limited
 * until a specific epoch ms. The cache layer uses this to gate the next call
 * to the provider and to surface stale-data fallback to the caller.
 */
export function attemptedRateLimitedResult(params: {
  label: string;
  message: string;
  rateLimitedUntil: number;
}): StatusProviderResult {
  return {
    attempted: true,
    entries: [],
    errors: [{ label: params.label, message: params.message }],
    rateLimitedUntil: params.rateLimitedUntil,
  };
}

export function mapNullableProviderResult<TSuccess extends { success: true }>(
  result: TSuccess | { success: false; error: string } | null,
  params: {
    errorLabel: string;
    onSuccess: (result: TSuccess) => StatusProviderResult;
  },
): StatusProviderResult {
  if (!result) {
    return notAttemptedResult();
  }

  if (!result.success) {
    return attemptedErrorResult(params.errorLabel, result.error);
  }

  return params.onSuccess(result);
}

export function groupedPercentWindowEntries(params: {
  group: string;
  windows: Array<{
    window?: {
      percentRemaining: number;
      resetTimeIso?: string;
    };
    suffix: string;
    label: string;
  }>;
  fallbackWhenEmpty?: boolean;
}): StatusProviderEntry[] {
  const entries: StatusProviderEntry[] = [];

  for (const { window, suffix, label } of params.windows) {
    if (!window) continue;

    entries.push({
      name: `${params.group} ${suffix}`,
      group: params.group,
      label,
      percentRemaining: window.percentRemaining,
      resetTimeIso: window.resetTimeIso,
    });
  }

  if (entries.length === 0 && params.fallbackWhenEmpty !== false) {
    entries.push({ name: params.group, percentRemaining: 0 });
  }

  return entries;
}
