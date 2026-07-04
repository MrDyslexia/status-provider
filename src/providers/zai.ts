/**
 * Z.ai provider wrapper.
 *
 * Normalizes Z.ai status into generic toast entries.
 */

import type { StatusProvider, StatusProviderContext, StatusProviderResult } from "../lib/entries.js";
import { queryZaiStatus } from "../lib/zai.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import {
  DEFAULT_ZAI_AUTH_CACHE_MAX_AGE_MS,
  resolveZaiAuthCached,
} from "../lib/zai-auth.js";
import {
  attemptedResult,
  groupedPercentWindowEntries,
  mapNullableProviderResult,
} from "./result-helpers.js";

export const zaiProvider: StatusProvider = {
  id: "zai",

  async isAvailable(ctx: StatusProviderContext): Promise<boolean> {
    const providerAvailable = await isCanonicalProviderAvailable({
      ctx,
      providerId: "zai",
      fallbackOnError: false,
    });
    if (!providerAvailable) {
      return false;
    }

    const auth = await resolveZaiAuthCached({
      maxAgeMs: DEFAULT_ZAI_AUTH_CACHE_MAX_AGE_MS,
    });
    return auth.state === "configured" || auth.state === "invalid";
  },

  matchesCurrentModel(model: string): boolean {
    const lower = model.toLowerCase();
    const provider = lower.split("/")[0];
    if (provider && (provider.includes("zai") || provider.includes("glm"))) {
      return true;
    }
    return lower.includes("glm");
  },

  async fetch(ctx: StatusProviderContext): Promise<StatusProviderResult> {
    const result = await queryZaiStatus({ requestTimeoutMs: ctx.config?.requestTimeoutMs });

    return mapNullableProviderResult(result, {
      errorLabel: "Z.ai",
      onSuccess: (result) =>
        attemptedResult(
          groupedPercentWindowEntries({
            group: result.label,
            windows: [
              { window: result.windows.fiveHour, suffix: "5h", label: "5h:" },
              { window: result.windows.weekly, suffix: "Weekly", label: "Weekly:" },
              { window: result.windows.mcp, suffix: "MCP", label: "MCP:" },
            ],
          }),
          [],
          {
            singleWindowDisplayName: result.label,
          },
        ),
    });
  },
};
