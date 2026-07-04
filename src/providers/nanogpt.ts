/**
 * NanoGPT provider wrapper.
 */

import type {
  StatusProvider,
  StatusProviderContext,
  StatusProviderResult,
  StatusProviderEntry,
} from "../lib/entries.js";
import { formatNanoGptBalanceValue, hasNanoGptApiKeyConfigured, queryNanoGptStatus } from "../lib/nanogpt.js";
import { modelProviderMatchesRuntimeId } from "../lib/provider-model-matching.js";
import { attemptedResult, mapNullableProviderResult } from "./result-helpers.js";

function formatUsageAmount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(Math.trunc(value));
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function formatUsageRight(window: { used: number; limit: number }): string {
  return `${formatUsageAmount(window.used)}/${formatUsageAmount(window.limit)}`;
}

type NanoGptStatusSuccess = Extract<
  NonNullable<Awaited<ReturnType<typeof queryNanoGptStatus>>>,
  { success: true }
>;

function mapNanoGptSuccess(result: NanoGptStatusSuccess): StatusProviderResult {
  const entries: StatusProviderEntry[] = [];
  const errors =
    result.endpointErrors?.map((entry) => ({
      label: entry.endpoint === "usage" ? "NanoGPT Usage" : "NanoGPT Balance",
      message: entry.message,
    })) ?? [];

  const subscription = result.subscription;
  if (subscription?.daily) {
    entries.push({
      name: "NanoGPT Daily",
      group: "NanoGPT",
      label: "Daily:",
      right: formatUsageRight(subscription.daily),
      percentRemaining: subscription.daily.percentRemaining,
      resetTimeIso: subscription.daily.resetTimeIso,
    });
  }

  if (subscription?.monthly) {
    entries.push({
      name: "NanoGPT Monthly",
      group: "NanoGPT",
      label: "Monthly:",
      right: formatUsageRight(subscription.monthly),
      percentRemaining: subscription.monthly.percentRemaining,
      resetTimeIso: subscription.monthly.resetTimeIso,
    });
  }

  const balanceValue = result.balance ? formatNanoGptBalanceValue(result.balance) : null;
  if (balanceValue) {
    entries.push({
      kind: "value",
      name: "NanoGPT Balance",
      group: "NanoGPT",
      label: "Balance:",
      value: balanceValue,
    });
  }

  if (subscription?.state && subscription.state.toLowerCase() !== "active") {
    errors.push({
      label: "NanoGPT",
      message: `Subscription state: ${subscription.state}`,
    });
  }

  if (entries.length === 0) {
    errors.push({
      label: "NanoGPT",
      message: "No usable NanoGPT status or balance data",
    });
  }

  return attemptedResult(entries, errors);
}

export const nanoGptProvider: StatusProvider = {
  id: "nanogpt",

  async isAvailable(_ctx: StatusProviderContext): Promise<boolean> {
    return await hasNanoGptApiKeyConfigured();
  },

  matchesCurrentModel(model: string): boolean {
    return modelProviderMatchesRuntimeId(model, "nanogpt");
  },

  async fetch(ctx: StatusProviderContext): Promise<StatusProviderResult> {
    const result = await queryNanoGptStatus({ requestTimeoutMs: ctx.config?.requestTimeoutMs });

    return mapNullableProviderResult(result, {
      errorLabel: "NanoGPT",
      onSuccess: mapNanoGptSuccess,
    });
  },
};
