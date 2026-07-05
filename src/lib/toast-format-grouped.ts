/**
 * Grouped toast formatter.
 *
 * Renders status entries grouped by provider/account with compact bars.
 * Designed to feel like a status dashboard while still respecting OpenCode toast width.
 */

import type { StatusProviderNameVariant, StatusProviderConfig } from "./types.js";
import type { StatusProviderEntry, StatusProviderError, SessionTokensData } from "./entries.js";
import { isValueEntry } from "./entries.js";
import {
  bar,
  boxWrapLines,
  DISPLAYED_PERCENT_LABEL_WIDTH,
  formatDisplayedPercentLabel,
  formatResetCountdown,
  joinBarAndTrailingLabel,
  padLeft,
  padRight,
  resolveDisplayedPercent,
  visibleLength,
} from "./format-utils.js";
import { formatGroupedHeader } from "./grouped-header-format.js";
import { normalizeGroupedStatusEntries } from "./grouped-entry-normalization.js";
import { renderSessionTokensLines } from "./session-tokens-format.js";
import { resolveProviderNameForVariant } from "./status-entry-display.js";

function normalizeLabelText(value?: string): string {
  return value?.trim().replace(/:+$/u, "").trim() ?? "";
}

const ANSI_RESET = "\x1B[0m";
const ANSI_GREEN = "\x1B[32m";
const ANSI_YELLOW = "\x1B[33m";
const ANSI_RED = "\x1B[31m";

function colorForPercent(percent: number): string {
  if (percent >= 70) return ANSI_GREEN;
  if (percent >= 30) return ANSI_YELLOW;
  return ANSI_RED;
}

function statusEmoji(percentRemaining: number): string {
  if (percentRemaining >= 70) return "🟢";
  if (percentRemaining >= 30) return "🟡";
  return "🔴";
}

function maybeColor(text: string, percent: number, colorVariant: StatusProviderConfig["colorVariant"]): string {
  return colorVariant === "auto" ? `${colorForPercent(percent)}${text}${ANSI_RESET}` : text;
}

function resolveGroupedHeader(group: string, variant: StatusProviderNameVariant): string {
  const trimmed = group.trim();
  const match = trimmed.match(/^([^()]+?)\s*(\(.+\))\s*$/);
  const baseName = match ? match[1]!.trim() : trimmed;
  const account = match ? match[2]!.trim() : "";
  const resolvedBase = resolveProviderNameForVariant(baseName, variant);
  const resolvedGroup = account ? `${resolvedBase} ${account}` : resolvedBase;
  return formatGroupedHeader(resolvedGroup);
}

function extractWindowLabel(text: string): string | null {
  const lower = normalizeLabelText(text).toLowerCase();
  if (!lower) return null;

  if (/\b(?:rpm|per minute|minute|minutes)\b/u.test(lower)) return "RPM";
  if (/\b(?:rolling|5h|5 h|5-hour|5 hour|five-hour|five hour)\b/u.test(lower)) return "Session";
  if (/\b(?:hourly|1h|1 h|1-hour|1 hour|hour)\b/u.test(lower)) return "Hourly";
  if (/\b(?:7d|7 d|7-day|7 day|weekly|week)\b/u.test(lower)) return "Weekly";
  if (/\b(?:daily|1d|1 d|1-day|1 day|day)\b/u.test(lower)) return "Daily";
  if (/\b(?:monthly|month)\b/u.test(lower)) return "Monthly";
  if (/\b(?:yearly|annual|annually|year)\b/u.test(lower)) return "Yearly";
  if (/\bmcp\b/u.test(lower)) return "MCP";
  if (/\bcode review\b/u.test(lower)) return "Code Review";

  return null;
}

function resolveGroupedRowLabel(entry: StatusProviderEntry): string {
  const rawLabel = normalizeLabelText(entry.label);
  const fromLabel = extractWindowLabel(rawLabel);
  if (fromLabel) return fromLabel;
  if (rawLabel) return rawLabel;

  const fromName = extractWindowLabel(entry.name);
  if (fromName) return fromName;

  return "Status window";
}

export function formatStatusRowsGrouped(params: {
  layout?: {
    maxWidth: number;
    barMaxWidth?: number;
    narrowAt: number;
    tinyAt: number;
  };
  entries?: StatusProviderEntry[];
  errors?: StatusProviderError[];
  percentDisplayMode?: StatusProviderConfig["percentDisplayMode"];
  sessionTokens?: SessionTokensData;
  textVariant?: StatusProviderConfig["textVariant"];
  providerNameVariant?: StatusProviderNameVariant;
  percentVariant?: StatusProviderConfig["percentVariant"];
  colorVariant?: StatusProviderConfig["colorVariant"];
  alignmentVariant?: StatusProviderConfig["alignmentVariant"];
}): string {
  const {
    textVariant = "default",
    providerNameVariant = "full",
    percentVariant = "both",
    colorVariant = "none",
    alignmentVariant = "left",
  } = params;

  const layout = params.layout ?? { maxWidth: 50, narrowAt: 42, tinyAt: 32 };
  const totalMaxWidth = layout.maxWidth;
  const barLineMaxWidth = Math.min(layout.barMaxWidth ?? totalMaxWidth, totalMaxWidth);
  const maxWidth = textVariant === "box" ? Math.max(10, totalMaxWidth - 4) : totalMaxWidth;
  const barLineWidth = textVariant === "box" ? Math.max(10, barLineMaxWidth - 4) : barLineMaxWidth;
  const isTiny = maxWidth <= layout.tinyAt;
  const isNarrow = !isTiny && maxWidth <= layout.narrowAt;

  const separator = "  ";
  const percentCol = Math.max(
    DISPLAYED_PERCENT_LABEL_WIDTH,
    ...(params.entries ?? [])
      .filter((entry) => !isValueEntry(entry))
      .map((entry) =>
        formatDisplayedPercentLabel(entry.percentRemaining, params.percentDisplayMode).length,
      ),
  );
  const barWidth = Math.max(10, maxWidth - separator.length - percentCol);
  const timeCol = isTiny ? 6 : isNarrow ? 7 : 7;

  const lines: string[] = [];

  // Group entries in stable order.
  const groupOrder: string[] = [];
  const groups = new Map<string, StatusProviderEntry[]>();
  for (const entry of normalizeGroupedStatusEntries(params.entries ?? [], "toast")) {
    const list = groups.get(entry.group);
    if (list) list.push(entry);
    else {
      groupOrder.push(entry.group);
      groups.set(entry.group, [entry]);
    }
  }

  const addMinimalPercentLine = (label: string, percentLabel: string) => {
    const available = maxWidth - separator.length - percentLabel.length;
    const nameCell = label.length > available ? label.slice(0, Math.max(1, available)) : label;
    const line = [
      alignmentVariant === "right" ? padLeft(nameCell, available) : padRight(nameCell, available),
      percentLabel,
    ].join(separator);
    lines.push(line.slice(0, maxWidth));
  };

  const addMinimalValueLine = (label: string, value: string) => {
    const available = maxWidth - separator.length - value.length;
    const nameCell = label.length > available ? label.slice(0, Math.max(1, available)) : label;
    const line = [
      alignmentVariant === "right" ? padLeft(nameCell, available) : padRight(nameCell, available),
      value,
    ].join(separator);
    lines.push(line.slice(0, maxWidth));
  };

  for (let gi = 0; gi < groupOrder.length; gi++) {
    const g = groupOrder[gi]!;
    const list = groups.get(g) ?? [];
    if (gi > 0) lines.push("");

    lines.push(resolveGroupedHeader(g, providerNameVariant).slice(0, maxWidth));

    for (const entry of list) {
      const right = entry.right ? entry.right.trim() : "";

      if (isValueEntry(entry)) {
        const label = entry.label?.trim() || entry.name;
        const timeStr = formatResetCountdown(entry.resetTimeIso);
        const value = entry.value.trim();

        if (textVariant === "minimal") {
          addMinimalValueLine(right ? `${label} ${right}` : label, value);
          continue;
        }

        if (isTiny) {
          // Tiny: "label  time  value"
          const valueCol = Math.min(value.length, Math.max(6, percentCol + 2));
          const tinyNameCol = Math.max(
            1,
            maxWidth - separator.length - timeCol - separator.length - valueCol,
          );
          const leftText = right ? `${label} ${right}` : label;
          const line = [
            padRight(leftText, tinyNameCol),
            padLeft(timeStr, timeCol),
            padLeft(value, valueCol),
          ].join(separator);
          lines.push(line.slice(0, maxWidth));
          continue;
        }

        // Non-tiny: single line (no bar)
        const timeWidth = Math.max(timeStr.length, timeCol);
        const valueWidth = Math.max(value.length, 6);
        const leftMax = Math.max(
          1,
          barWidth - separator.length - valueWidth - separator.length - timeWidth,
        );
        const leftText = right ? `${label} ${right}` : label;
        lines.push(
          (padRight(leftText, leftMax) +
            separator +
            padLeft(value, valueWidth) +
            separator +
            padLeft(timeStr, timeWidth)).slice(0, maxWidth),
        );
        continue;
      }

      const label = resolveGroupedRowLabel(entry);

      // Percent entries
      // Show reset countdown whenever status is not fully available.
      // (i.e., any usage at all, or depleted)
      const timeStr =
        entry.percentRemaining < 100 && textVariant !== "minimal"
          ? formatResetCountdown(entry.resetTimeIso)
          : "";
      const displayedPercent = resolveDisplayedPercent(
        entry.percentRemaining,
        params.percentDisplayMode,
      );
      const rawPercentLabel = formatDisplayedPercentLabel(
        entry.percentRemaining,
        params.percentDisplayMode,
      );
      const percentLabel = maybeColor(rawPercentLabel, displayedPercent, colorVariant);
      const emoji = textVariant === "emoji" ? `${statusEmoji(entry.percentRemaining)} ` : "";
      const leftLabel = `${emoji}${label}`;

      if (textVariant === "minimal") {
        addMinimalPercentLine(leftLabel, percentLabel);
        continue;
      }

      if (isTiny) {
        // Tiny: "label  time  XX%" (ignore bar)
        const tinyNameCol = Math.max(
          1,
          maxWidth - separator.length - timeCol - separator.length - percentCol,
        );
        const line = [
          padRight(leftLabel, tinyNameCol),
          padLeft(timeStr, timeCol),
          padLeft(percentLabel, percentCol),
        ].join(separator);
        lines.push(line.slice(0, maxWidth));
        continue;
      }

      // Line 1: label + optional right + time at end
      const timeWidth = Math.max(timeStr.length, timeCol);
      const leftMax = Math.max(1, maxWidth - separator.length - timeWidth);
      lines.push(
        (padRight(leftLabel, leftMax) + separator + padLeft(timeStr, timeWidth)).slice(0, maxWidth),
      );

      // Line 2: bar + percent label.
      if (percentVariant === "number") {
        lines.push(percentLabel);
      } else {
        const trailingBarWidth = Math.max(10, barLineWidth - separator.length - visibleLength(percentLabel));
        lines.push(joinBarAndTrailingLabel(bar(displayedPercent, trailingBarWidth), percentLabel, barLineWidth, separator));
      }
    }
  }

  for (const err of params.errors ?? []) {
    if (lines.length > 0) lines.push("");
    lines.push(`${err.label}: ${err.message}`);
  }

  // Add session token summary (if data available and non-empty)
  const tokenLines = renderSessionTokensLines(params.sessionTokens, { maxWidth });
  if (tokenLines.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(...tokenLines);
  }

  const body = lines.join("\n");

  if (textVariant !== "box") {
    return body;
  }

  const bodyLines = body ? body.split("\n") : [];
  if (bodyLines.length === 0) {
    return "";
  }

  return boxWrapLines(bodyLines, maxWidth).join("\n");
}
