/**
 * Provider registry.
 *
 * Add new providers here; everything else should stay provider-agnostic.
 */

import type { StatusProvider } from "../lib/entries.js";
import type { StatusProviderConfig } from "../lib/types.js";
import { normalizeStatusProviderId } from "../lib/provider-metadata.js";
import { anthropicProvider } from "./anthropic.js";
import { copilotProvider } from "./copilot.js";
import { openaiProvider } from "./openai.js";
import { cursorProvider } from "./cursor.js";
import { googleAntigravityProvider } from "./google-antigravity.js";
import { googleGeminiCliProvider } from "./google-gemini-cli.js";
import { syntheticProvider } from "./synthetic.js";
import { chutesProvider } from "./chutes.js";
import { crofProvider } from "./crof.js";
import { qwenCodeProvider } from "./qwen-code.js";
import { alibabaCodingPlanProvider } from "./alibaba-coding-plan.js";
import { zaiProvider } from "./zai.js";
import { zhipuProvider } from "./zhipu.js";
import { nanoGptProvider } from "./nanogpt.js";
import {
  minimaxChinaCodingPlanProvider,
  minimaxCodingPlanProvider,
} from "./minimax-coding-plan.js";
import { opencodeGoProvider } from "./opencode-go.js";
import { kimiCodeProvider } from "./kimi-code.js";

export function getProviders(): StatusProvider[] {
  // Order here defines display ordering in the toast.
  return [
    anthropicProvider,
    copilotProvider,
    openaiProvider,
    cursorProvider,
    qwenCodeProvider,
    alibabaCodingPlanProvider,
    syntheticProvider,
    chutesProvider,
    crofProvider,
    googleAntigravityProvider,
    googleGeminiCliProvider,
    zaiProvider,
    zhipuProvider,
    nanoGptProvider,
    minimaxCodingPlanProvider,
    minimaxChinaCodingPlanProvider,
    kimiCodeProvider,
    opencodeGoProvider,
  ];
}

/**
 * Return providers ordered according to config.providerOrder.
 *
 * - Listed providers appear in the requested order.
 * - Unlisted providers are appended in their default registry order.
 * - When enabledProviders is explicit, only those IDs are returned (in providerOrder first).
 * - Duplicates are removed.
 */
export function getOrderedProviders(config: StatusProviderConfig): StatusProvider[] {
  const all = getProviders();
  const byId = new Map(all.map((p) => [p.id, p]));

  const orderedIds = (config.providerOrder.length > 0 ? config.providerOrder : all.map((p) => p.id)).map(
    (id) => normalizeStatusProviderId(id),
  );

  const enabledIds =
    config.enabledProviders === "auto"
      ? new Set(orderedIds)
      : new Set(config.enabledProviders.map((id) => normalizeStatusProviderId(id)));

  const ordered: StatusProvider[] = [];
  const seen = new Set<string>();

  function addProviderId(id: string): void {
    const normalizedId = normalizeStatusProviderId(id);
    if (seen.has(normalizedId)) return;
    const provider = byId.get(normalizedId);
    if (!provider) return;
    if (!enabledIds.has(normalizedId)) return;
    seen.add(normalizedId);
    ordered.push(provider);
  }

  for (const id of orderedIds) {
    addProviderId(id);
  }

  for (const provider of all) {
    addProviderId(provider.id);
  }

  return ordered;
}
