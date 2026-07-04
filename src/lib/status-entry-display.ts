import type { StatusProviderEntry } from "./entries.js";
import type { StatusProviderNameVariant } from "./types.js";
import { formatGroupedHeader } from "./grouped-header-format.js";
import {
  findStatusProviderIdByDisplayLabel,
  getStatusProviderIcon,
  getStatusProviderShortLabel,
} from "./provider-metadata.js";

export function normalizeSingleWindowLabelText(value?: string): string {
  return value?.trim().replace(/:+$/u, "").trim() ?? "";
}

export function extractSingleWindowWindowLabel(text: string): string | null {
  const lower = normalizeSingleWindowLabelText(text).toLowerCase();
  if (!lower) return null;

  if (/\b(?:rpm|per minute|minute|minutes)\b/u.test(lower)) return "RPM";
  if (/\b(?:rolling|5h|5 h|5-hour|5 hour|five-hour|five hour)\b/u.test(lower)) return "5h";
  if (/\b(?:hourly|1h|1 h|1-hour|1 hour|hour)\b/u.test(lower)) return "Hourly";
  if (/\b(?:7d|7 d|7-day|7 day|weekly|week)\b/u.test(lower)) return "Weekly";
  if (/\b(?:daily|1d|1 d|1-day|1 day|day)\b/u.test(lower)) return "Daily";
  if (/\b(?:monthly|month)\b/u.test(lower)) return "Monthly";
  if (/\b(?:yearly|annual|annually|year)\b/u.test(lower)) return "Yearly";
  if (/\bmcp\b/u.test(lower)) return "MCP";
  if (/\bcode review\b/u.test(lower)) return "Code Review";

  return null;
}

function resolveProviderNameForVariant(name: string, variant: StatusProviderNameVariant): string {
  if (variant === "full") return name;

  const providerId = findStatusProviderIdByDisplayLabel(name);
  if (!providerId) return name;

  if (variant === "short") {
    return getStatusProviderShortLabel(providerId);
  }

  const icon = getStatusProviderIcon(providerId);
  const shortLabel = getStatusProviderShortLabel(providerId);
  return `${icon} ${shortLabel}`;
}

export { resolveProviderNameForVariant };

export function buildSingleWindowPercentEntryDisplayName(
  entry: StatusProviderEntry,
  providerNameVariant: StatusProviderNameVariant = "full",
): string {
  const name = entry.name.trim();
  const group = entry.group?.trim();
  const windowLabel =
    extractSingleWindowWindowLabel(entry.label ?? "") ??
    extractSingleWindowWindowLabel(entry.name);

  if (name.startsWith("[")) {
    if (!windowLabel) return name;
    return name.toLowerCase().includes(windowLabel.toLowerCase()) ? name : `${name} ${windowLabel}`;
  }

  if (group) {
    const provider = resolveProviderNameForVariant(formatGroupedHeader(group), providerNameVariant);
    return windowLabel ? `${provider} ${windowLabel}` : provider;
  }

  return resolveProviderNameForVariant(name, providerNameVariant);
}
