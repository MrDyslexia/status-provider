import type {
  StatusProvider,
  StatusProviderContext,
  StatusProviderResult,
  StatusProviderEntry,
} from "../lib/entries.js";
import { computeQwenStatus, readQwenLocalStatusState } from "../lib/qwen-local-status.js";
import {
  DEFAULT_QWEN_AUTH_CACHE_MAX_AGE_MS,
  isQwenCodeModelId,
  resolveQwenLocalPlanCached,
} from "../lib/qwen-auth.js";
import { attemptedResult, notAttemptedResult } from "./result-helpers.js";

export const qwenCodeProvider: StatusProvider = {
  id: "qwen-code",

  async isAvailable(_ctx: StatusProviderContext): Promise<boolean> {
    const plan = await resolveQwenLocalPlanCached({
      maxAgeMs: DEFAULT_QWEN_AUTH_CACHE_MAX_AGE_MS,
    });
    return plan.state === "qwen_free";
  },

  matchesCurrentModel(model: string): boolean {
    return isQwenCodeModelId(model);
  },

  async fetch(ctx: StatusProviderContext): Promise<StatusProviderResult> {
    const plan = await resolveQwenLocalPlanCached({
      maxAgeMs: DEFAULT_QWEN_AUTH_CACHE_MAX_AGE_MS,
    });
    if (plan.state !== "qwen_free") {
      return notAttemptedResult();
    }

    const status = computeQwenStatus({ state: await readQwenLocalStatusState() });

    return attemptedResult(
      [
        {
          name: "Qwen Free Daily",
          group: "Qwen (free)",
          label: "Daily:",
          right: `${status.day.used}/${status.day.limit}`,
          percentRemaining: status.day.percentRemaining,
          resetTimeIso: status.day.resetTimeIso,
        },
        {
          name: "Qwen Free RPM",
          group: "Qwen (free)",
          label: "RPM:",
          right: `${status.rpm.used}/${status.rpm.limit}`,
          percentRemaining: status.rpm.percentRemaining,
          resetTimeIso: status.rpm.resetTimeIso,
        },
      ],
      [],
    );
  },
};
