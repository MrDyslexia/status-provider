import type {
  StatusProvider,
  StatusProviderContext,
  StatusProviderResult,
  StatusProviderEntry,
} from "../lib/entries.js";
import {
  computeAlibabaCodingPlanStatus,
  readAlibabaCodingPlanStatusState,
} from "../lib/qwen-local-status.js";
import {
  DEFAULT_ALIBABA_AUTH_CACHE_MAX_AGE_MS,
  isAlibabaModelId,
  resolveAlibabaCodingPlanAuthCached,
} from "../lib/alibaba-auth.js";
import { attemptedErrorResult, attemptedResult, notAttemptedResult } from "./result-helpers.js";

function tierLabel(tier: "lite" | "pro"): string {
  return tier === "pro" ? "Pro" : "Lite";
}

export const alibabaCodingPlanProvider: StatusProvider = {
  id: "alibaba-coding-plan",

  async isAvailable(_ctx: StatusProviderContext): Promise<boolean> {
    const plan = await resolveAlibabaCodingPlanAuthCached({
      maxAgeMs: DEFAULT_ALIBABA_AUTH_CACHE_MAX_AGE_MS,
      fallbackTier: _ctx.config.alibabaCodingPlanTier,
    });
    return plan.state === "configured" || plan.state === "invalid";
  },

  matchesCurrentModel(model: string): boolean {
    return isAlibabaModelId(model);
  },

  async fetch(ctx: StatusProviderContext): Promise<StatusProviderResult> {
    const plan = await resolveAlibabaCodingPlanAuthCached({
      maxAgeMs: DEFAULT_ALIBABA_AUTH_CACHE_MAX_AGE_MS,
      fallbackTier: ctx.config.alibabaCodingPlanTier,
    });
    if (plan.state === "none") {
      return notAttemptedResult();
    }

    if (plan.state === "invalid") {
      return attemptedErrorResult("Alibaba Coding Plan", plan.error);
    }

    const status = computeAlibabaCodingPlanStatus({
      state: await readAlibabaCodingPlanStatusState(),
      tier: plan.tier,
    });
    const label = `Alibaba Coding Plan (${tierLabel(plan.tier)})`;

    const entries: StatusProviderEntry[] = [
      {
        name: `${label} 5h`,
        group: label,
        label: "5h:",
        right: `${status.fiveHour.used}/${status.fiveHour.limit}`,
        percentRemaining: status.fiveHour.percentRemaining,
        resetTimeIso: status.fiveHour.resetTimeIso,
      },
      {
        name: `${label} Weekly`,
        group: label,
        label: "Weekly:",
        right: `${status.weekly.used}/${status.weekly.limit}`,
        percentRemaining: status.weekly.percentRemaining,
        resetTimeIso: status.weekly.resetTimeIso,
      },
      {
        name: `${label} Monthly`,
        group: label,
        label: "Monthly:",
        right: `${status.monthly.used}/${status.monthly.limit}`,
        percentRemaining: status.monthly.percentRemaining,
        resetTimeIso: status.monthly.resetTimeIso,
      },
    ];

    return attemptedResult(entries);
  },
};
