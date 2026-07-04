/**
 * Template target: src/providers/<provider>.ts
 *
 * Purpose: wire provider availability, current-model matching, and status-result
 * mapping into the status provider registry.
 */

import type { StatusProvider, StatusProviderContext, StatusProviderResult } from "../lib/entries.js";
import { hasExampleProviderApiKey } from "../lib/example-provider-config.js";
import { queryExampleProviderStatus } from "../lib/example-provider.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import { modelProviderIncludesAny } from "../lib/provider-model-matching.js";
import { attemptedErrorResult, attemptedResult, notAttemptedResult } from "./result-helpers.js";

export const exampleProviderProvider: StatusProvider = {
  id: "example-provider",

  async isAvailable(ctx: StatusProviderContext): Promise<boolean> {
    const providerAvailable = await isCanonicalProviderAvailable({
      ctx,
      providerId: "example-provider",
      fallbackOnError: false,
    });
    if (providerAvailable) return true;

    return await hasExampleProviderApiKey();
  },

  matchesCurrentModel(model: string): boolean {
    return modelProviderIncludesAny(model, ["example-provider", "example"]);
  },

  async fetch(ctx: StatusProviderContext): Promise<StatusProviderResult> {
    const result = await queryExampleProviderStatus({ requestTimeoutMs: ctx.config?.requestTimeoutMs });

    if (!result) return notAttemptedResult();

    if (!result.success) {
      return attemptedErrorResult("Example Provider", result.error);
    }

    return attemptedResult([
      {
        name: "Example Provider",
        percentRemaining: result.percentRemaining,
        resetTimeIso: result.resetTimeIso,
      },
    ]);
  },
};
