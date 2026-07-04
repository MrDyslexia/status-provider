/**
 * Google Antigravity provider wrapper.
 */

import type { StatusProvider, StatusProviderContext, StatusProviderResult } from "../lib/entries.js";
import type { GoogleModelId } from "../lib/types.js";
import { hasAntigravityStatusRuntimeAvailable, queryGoogleStatus } from "../lib/google.js";
import { modelProviderIncludesAny } from "../lib/provider-model-matching.js";
import {
  formatGoogleAccountErrors,
  formatGoogleAccountLabel,
} from "./google-account-format.js";
import { attemptedErrorResult, attemptedResult, notAttemptedResult } from "./result-helpers.js";

async function isAccountsConfigured(): Promise<boolean> {
  try {
    return await hasAntigravityStatusRuntimeAvailable();
  } catch {
    return false;
  }
}

export const googleAntigravityProvider: StatusProvider = {
  id: "google-antigravity",

  async isAvailable(_ctx: StatusProviderContext): Promise<boolean> {
    // Google status depends on both the accounts file and the separately
    // installed companion auth plugin.
    return await isAccountsConfigured();
  },

  matchesCurrentModel(model: string): boolean {
    return modelProviderIncludesAny(model, ["google", "antigravity", "opencode"]);
  },

  async fetch(ctx: StatusProviderContext): Promise<StatusProviderResult> {
    const modelIds = ctx.config.googleModels as GoogleModelId[];
    const result = await queryGoogleStatus(modelIds, {
      requestTimeoutMs: ctx.config?.requestTimeoutMs,
    });

    if (!result) {
      return notAttemptedResult();
    }

    if (!result.success) {
      return attemptedErrorResult("Antigravity", result.error);
    }

    const entries = result.models.map((m) => {
      const emailLabel = formatGoogleAccountLabel(m.accountEmail, "fixedGmailHint") || "Antigravity";
      return {
        name: `${m.displayName} (${emailLabel})`,
        percentRemaining: m.percentRemaining,
        resetTimeIso: m.resetTimeIso,
      };
    });

    return attemptedResult(
      entries,
      formatGoogleAccountErrors(result.errors, "fixedGmailHint"),
    );
  },
};
