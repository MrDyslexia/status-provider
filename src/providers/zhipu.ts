/**
 * Zhipu provider wrapper.
 *
 * Normalizes Zhipu status into generic toast entries.
 */

import type { StatusProvider, StatusProviderContext, StatusProviderResult } from "../lib/entries.js";
import { queryZhipuStatus } from "../lib/zhipu.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import {
  DEFAULT_ZHIPU_AUTH_CACHE_MAX_AGE_MS,
  resolveZhipuAuthCached,
} from "../lib/zhipu-auth.js";
import {
  attemptedResult,
  groupedPercentWindowEntries,
  mapNullableProviderResult,
} from "./result-helpers.js";

export const zhipuProvider: StatusProvider = {
  id: "zhipu",

  async isAvailable(ctx: StatusProviderContext): Promise<boolean> {
    const providerAvailable = await isCanonicalProviderAvailable({
      ctx,
      providerId: "zhipu",
      fallbackOnError: false,
    });
    if (!providerAvailable) {
      return false;
    }

    const auth = await resolveZhipuAuthCached({
      maxAgeMs: DEFAULT_ZHIPU_AUTH_CACHE_MAX_AGE_MS,
    });
    return auth.state === "configured" || auth.state === "invalid";
  },

  matchesCurrentModel(model: string): boolean {
    const lower = model.toLowerCase();
    const provider = lower.split("/")[0];
    return !!provider && (provider.includes("zhipu") || provider === "glm-coding-plan");
  },

  async fetch(ctx: StatusProviderContext): Promise<StatusProviderResult> {
    const result = await queryZhipuStatus({ requestTimeoutMs: ctx.config?.requestTimeoutMs });

    return mapNullableProviderResult(result, {
      errorLabel: "Zhipu",
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
