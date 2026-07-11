/**
 * Anthropic Claude provider wrapper.
 *
 * Normalizes Claude CLI-exposed status windows into generic toast entries.
 */

import type {
  StatusProvider,
  StatusProviderContext,
  StatusProviderResult,
  StatusProviderEntry,
} from "../lib/entries.js";
import { hasAnthropicCredentialsConfigured, queryAnthropicStatus } from "../lib/anthropic.js";
import { attemptedErrorResult, attemptedResult, notAttemptedResult } from "./result-helpers.js";

export function getAnthropicNoDataMessage(): string {
  return "Status unavailable via local Claude CLI or Claude OAuth fallback";
}

export const anthropicProvider: StatusProvider = {
  id: "anthropic",

  async isAvailable(ctx: StatusProviderContext): Promise<boolean> {
    return await hasAnthropicCredentialsConfigured({
      binaryPath: ctx.config?.anthropicBinaryPath,
    });
  },

  matchesCurrentModel(model: string): boolean {
    return model.toLowerCase().startsWith("anthropic/");
  },

  async fetch(ctx: StatusProviderContext): Promise<StatusProviderResult> {
    const result = await queryAnthropicStatus({
      binaryPath: ctx.config?.anthropicBinaryPath,
      requestTimeoutMs: ctx.config?.requestTimeoutMs,
    });

    if (!result) {
      return notAttemptedResult();
    }

    if (!result.success) {
      // authExpiredUntil marks a token rejected mid-session that status-fork
      // will keep trying to refresh in the background — surface it as a
      // transient/self-healing state rather than a hard failure.
      const isAuthExpired = typeof result.authExpiredUntil === "number";
      const errorResult = attemptedErrorResult("Claude", result.error, { retryable: isAuthExpired });
      if (typeof result.rateLimitedUntil === "number") {
        return { ...errorResult, rateLimitedUntil: result.rateLimitedUntil };
      }
      return errorResult;
    }

    const entries: StatusProviderEntry[] = [
      {
        name: "Claude 5h",
        group: "Claude",
        label: "5h:",
        percentRemaining: result.five_hour.percentRemaining,
        resetTimeIso: result.five_hour.resetTimeIso,
      },
      {
        name: "Claude Weekly",
        group: "Claude",
        label: "Weekly:",
        percentRemaining: result.seven_day.percentRemaining,
        resetTimeIso: result.seven_day.resetTimeIso,
      },
    ];

    return attemptedResult(entries);
  },
};
