/**
 * Crof.ai provider wrapper.
 */

import type {
  StatusProvider,
  StatusProviderContext,
  StatusProviderResult,
  StatusProviderEntry,
} from "../lib/entries.js";
import { formatCrofCreditsValue, hasCrofApiKeyConfigured, queryCrofStatus } from "../lib/crof.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import { modelProviderMatchesRuntimeId } from "../lib/provider-model-matching.js";
import { attemptedResult, mapNullableProviderResult } from "./result-helpers.js";

function formatRequestAmount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(Math.trunc(value));
  return value.toFixed(2).replace(/\.?0+$/u, "");
}

export const crofProvider: StatusProvider = {
  id: "crof",

  async isAvailable(ctx: StatusProviderContext): Promise<boolean> {
    const providerAvailable = await isCanonicalProviderAvailable({
      ctx,
      providerId: "crof",
      fallbackOnError: false,
    });
    if (providerAvailable) return true;

    return await hasCrofApiKeyConfigured();
  },

  matchesCurrentModel(model: string): boolean {
    return modelProviderMatchesRuntimeId(model, "crof");
  },

  async fetch(ctx: StatusProviderContext): Promise<StatusProviderResult> {
    const result = await queryCrofStatus({ requestTimeoutMs: ctx.config?.requestTimeoutMs });

    return mapNullableProviderResult(result, {
      errorLabel: "Crof",
      onSuccess: (result) => {
        const entries: StatusProviderEntry[] = [
          {
            name: "Crof Requests",
            group: "Crof",
            label: "Requests:",
            right: `${formatRequestAmount(result.usableRequests)}/${formatRequestAmount(result.requestsPlan)}`,
            percentRemaining: result.percentRemaining,
          },
          {
            kind: "value",
            name: "Crof Credits",
            group: "Crof",
            label: "Credits:",
            value: formatCrofCreditsValue(result.credits),
          },
        ];

        return attemptedResult(entries);
      },
    });
  },
};
