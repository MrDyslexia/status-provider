import type {
  StatusProvider,
  StatusProviderContext,
  StatusProviderResult,
  StatusProviderEntry,
} from "../lib/entries.js";
import { queryKimiStatus } from "../lib/kimi.js";
import { DEFAULT_KIMI_AUTH_CACHE_MAX_AGE_MS, resolveKimiAuthCached } from "../lib/kimi-auth.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import { normalizeStatusProviderId } from "../lib/provider-metadata.js";
import { attemptedErrorResult, attemptedResult, notAttemptedResult } from "./result-helpers.js";

function formatUsageRight(window: { used: number; limit: number }): string {
  return `${window.used}/${window.limit}`;
}

export const kimiCodeProvider: StatusProvider = {
  id: "kimi-for-coding",

  async isAvailable(ctx: StatusProviderContext): Promise<boolean> {
    const providerAvailable = await isCanonicalProviderAvailable({
      ctx,
      providerId: "kimi-for-coding",
      fallbackOnError: false,
    });
    if (!providerAvailable) {
      return false;
    }

    const auth = await resolveKimiAuthCached({
      maxAgeMs: DEFAULT_KIMI_AUTH_CACHE_MAX_AGE_MS,
    });
    return auth.state === "configured" || auth.state === "invalid";
  },

  matchesCurrentModel(model: string): boolean {
    const [provider] = model.toLowerCase().split("/", 2);
    return normalizeStatusProviderId(provider) === "kimi-for-coding";
  },

  async fetch(ctx: StatusProviderContext): Promise<StatusProviderResult> {
    const auth = await resolveKimiAuthCached({
      maxAgeMs: DEFAULT_KIMI_AUTH_CACHE_MAX_AGE_MS,
    });

    if (auth.state === "none") {
      return notAttemptedResult();
    }

    if (auth.state === "invalid") {
      return attemptedErrorResult("Kimi Code", auth.error);
    }

    const result = await queryKimiStatus({ requestTimeoutMs: ctx.config?.requestTimeoutMs });

    if (!result) {
      return notAttemptedResult();
    }

    if (!result.success) {
      return attemptedErrorResult("Kimi Code", result.error);
    }

    const entries: StatusProviderEntry[] = result.windows.map((window) => ({
      name: `${result.label} ${window.label}`,
      group: result.label,
      label: `${window.label}:`,
      right: formatUsageRight(window),
      percentRemaining: window.percentRemaining,
      resetTimeIso: window.resetTimeIso,
    }));

    return attemptedResult(entries, [], {
      singleWindowDisplayName: result.label,
    });
  },
};
