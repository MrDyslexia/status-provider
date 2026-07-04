/**
 * Formatting helpers for status toast output
 */

import type { StatusProviderNameVariant, StatusProviderConfig } from "./types.js";
import type { StatusProviderEntry, StatusProviderError, SessionTokensData } from "./entries.js";
import type { StatusFormatStyle } from "./status-format-style.js";
import { isValueEntry } from "./entries.js";
import {
  bar,
  boxWrapLines,
  DISPLAYED_PERCENT_LABEL_WIDTH,
  formatDisplayedPercentLabel,
  formatResetCountdown,
  padLeft,
  padRight,
  resolveDisplayedPercent,
} from "./format-utils.js";
import { formatStatusRowsGrouped } from "./toast-format-grouped.js";
import {
  renderSessionTokensLines,
  renderSidebarSessionTokenSummaryLines,
} from "./session-tokens-format.js";
import { getStatusFormatStyleDefinition } from "./status-format-style.js";
import { buildSingleWindowPercentEntryDisplayName, resolveProviderNameForVariant } from "./status-entry-display.js";

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

function applyProviderNameVariant(
  entry: StatusProviderEntry,
  variant: StatusProviderNameVariant,
): string {
  return buildSingleWindowPercentEntryDisplayName(entry, variant);
}

function buildClassicNameTimeLine(params: {
  leftText: string;
  timeStr: string;
  maxWidth: number;
  separator: string;
  preferredTimeWidth: number;
}): string {
  if (!params.timeStr) {
    return params.leftText.slice(0, params.maxWidth);
  }

  let timeWidth = Math.max(params.timeStr.length, params.preferredTimeWidth);
  const preferredNameWidth = params.maxWidth - params.separator.length - timeWidth;
  const compactLineWidth = params.leftText.length + params.separator.length + params.timeStr.length;
  if (params.leftText.length > preferredNameWidth && compactLineWidth <= params.maxWidth) {
    timeWidth = params.timeStr.length;
  }

  const nameWidth = Math.max(1, params.maxWidth - params.separator.length - timeWidth);
  return (
    padRight(params.leftText, nameWidth) +
    params.separator +
    padLeft(params.timeStr, timeWidth)
  ).slice(0, params.maxWidth);
}

function buildClassicValueLine(params: {
  name: string;
  value: string;
  timeStr: string;
  maxWidth: number;
  separator: string;
  preferredValueWidth: number;
  preferredTimeWidth: number;
}): string {
  let valueWidth = Math.max(params.value.length, params.preferredValueWidth);
  let timeWidth = Math.max(params.timeStr.length, params.preferredTimeWidth);
  const preferredNameWidth =
    params.maxWidth - params.separator.length - valueWidth - params.separator.length - timeWidth;
  const compactLineWidth =
    params.name.length +
    params.separator.length +
    params.value.length +
    params.separator.length +
    params.timeStr.length;

  if (params.name.length > preferredNameWidth && compactLineWidth <= params.maxWidth) {
    valueWidth = params.value.length;
    timeWidth = params.timeStr.length;
  }

  const nameWidth = Math.max(
    1,
    params.maxWidth - params.separator.length - valueWidth - params.separator.length - timeWidth,
  );
  return (
    padRight(params.name, nameWidth) +
    params.separator +
    padLeft(params.value, valueWidth) +
    params.separator +
    padLeft(params.timeStr, timeWidth)
  ).slice(0, params.maxWidth);
}

export function formatStatusRows(params: {
  version: string;
  layout?: {
    maxWidth: number;
    narrowAt: number;
    tinyAt: number;
  };
  entries?: StatusProviderEntry[];
  errors?: StatusProviderError[];
  style?: StatusFormatStyle;
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
  } = params;
  const styleDefinition = getStatusFormatStyleDefinition(params.style);

  if (styleDefinition.renderer === "grouped") {
    return formatStatusRowsGrouped({
      layout: params.layout,
      entries: params.entries,
      errors: params.errors,
      percentDisplayMode: params.percentDisplayMode,
      sessionTokens: params.sessionTokens,
      textVariant: params.textVariant,
      providerNameVariant: params.providerNameVariant,
      percentVariant: params.percentVariant,
      colorVariant: params.colorVariant,
      alignmentVariant: params.alignmentVariant,
    });
  }

  const layout = params.layout ?? { maxWidth: 50, narrowAt: 42, tinyAt: 32 };
  const totalMaxWidth = layout.maxWidth;
  const maxWidth = textVariant === "box" ? Math.max(10, totalMaxWidth - 4) : totalMaxWidth;

  // Responsive columns.
  // - default: name + time on one line, then bar on next line
  // - narrow: shorter name/time cols
  // - tiny: no bars, just "Name  time  XX%"
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

  const timeCol = isTiny ? 6 : isNarrow ? 7 : 7;

  // Bar width: use most of maxWidth, leaving room for separator + percent on line 2.
  // Line 1 (name + time) can use full maxWidth so labels are not cut before the
  // sidebar width is exhausted.
  // Line 2 (bar + percent) spans barWidth + separator + percentCol.
  const barWidth = Math.max(10, maxWidth - separator.length - percentCol);

  const lines: string[] = [];

  const addMinimalPercentLine = (name: string, percentLabel: string) => {
    const available = maxWidth - separator.length - percentLabel.length;
    const nameCell = name.length > available ? name.slice(0, Math.max(1, available)) : name;
    const line = [
      params.alignmentVariant === "right" ? padLeft(nameCell, available) : padRight(nameCell, available),
      percentLabel,
    ].join(separator);
    lines.push(line.slice(0, maxWidth));
  };

  const addMinimalValueLine = (name: string, value: string) => {
    const available = maxWidth - separator.length - value.length;
    const nameCell = name.length > available ? name.slice(0, Math.max(1, available)) : name;
    const line = [
      params.alignmentVariant === "right" ? padLeft(nameCell, available) : padRight(nameCell, available),
      value,
    ].join(separator);
    lines.push(line.slice(0, maxWidth));
  };

  const addPercentEntry = (
    name: string,
    resetIso: string | undefined,
    remaining: number,
    rightSummary?: string,
  ) => {
    const displayedPercent = resolveDisplayedPercent(remaining, params.percentDisplayMode);
    const rawPercentLabel = formatDisplayedPercentLabel(remaining, params.percentDisplayMode);
    const coloredPercentLabel = maybeColor(rawPercentLabel, displayedPercent, colorVariant);
    const summary = rightSummary?.trim() || "";
    const emoji = textVariant === "emoji" ? `${statusEmoji(remaining)} ` : "";
    const leftText = summary ? `${emoji}${name} ${summary}` : `${emoji}${name}`;

    const timeStr =
      remaining < 100 && textVariant !== "minimal"
        ? formatResetCountdown(resetIso, { missing: "-", compactRounded: true })
        : "";

    if (textVariant === "minimal") {
      addMinimalPercentLine(leftText, coloredPercentLabel);
      return;
    }

    if (isTiny) {
      // In tiny mode: single line with name + time + percent
      const tinyNameCol = Math.max(
        1,
        maxWidth - separator.length - timeCol - separator.length - percentCol,
      );
      const line = [
        padRight(leftText, tinyNameCol),
        padLeft(timeStr, timeCol),
        padLeft(coloredPercentLabel, percentCol),
      ].join(separator);
      lines.push(line.slice(0, maxWidth));
      return;
    }

    // Line 1: label + time can use the full available width. Prefer keeping the
    // reset text aligned, but shrink padding before truncating labels that fit.
    lines.push(
      buildClassicNameTimeLine({
        leftText,
        timeStr,
        maxWidth,
        separator,
        preferredTimeWidth: timeCol,
      }),
    );

    // Line 2: bar + percent (percent extends beyond bar width)
    if (percentVariant === "number") {
      lines.push(coloredPercentLabel);
    } else if (percentVariant === "bar") {
      lines.push(bar(displayedPercent, barWidth));
    } else {
      const barCell = bar(displayedPercent, barWidth);
      const percentCell = padLeft(coloredPercentLabel, percentCol);
      const barLine = [barCell, percentCell].join(separator);
      lines.push(barLine);
    }
  };

  const addValueEntry = (name: string, resetIso: string | undefined, value: string) => {
    const timeStr =
      textVariant !== "minimal"
        ? formatResetCountdown(resetIso, { missing: "-", compactRounded: true })
        : "";

    if (textVariant === "minimal") {
      addMinimalValueLine(name, value);
      return;
    }

    if (isTiny) {
      // Tiny: single line without percent; keep time col alignment.
      const valueCol = Math.min(value.length, Math.max(6, percentCol + 2));
      const tinyNameCol =
        maxWidth - separator.length - timeCol - separator.length - valueCol;
      const nameCol = Math.max(1, tinyNameCol);
      const line = [
        padRight(name, nameCol),
        padLeft(timeStr, timeCol),
        padLeft(value, valueCol),
      ].join(separator);
      lines.push(line.slice(0, maxWidth));
      return;
    }

    lines.push(
      buildClassicValueLine({
        name,
        value,
        timeStr,
        maxWidth,
        separator,
        preferredValueWidth: 6,
        preferredTimeWidth: timeCol,
      }),
    );
  };

  for (const entry of params.entries ?? []) {
    if (isValueEntry(entry)) {
      const displayName = resolveProviderNameForVariant(entry.name, providerNameVariant);
      addValueEntry(displayName, entry.resetTimeIso, entry.value);
    } else {
      const displayName = applyProviderNameVariant(entry, providerNameVariant);
      addPercentEntry(displayName, entry.resetTimeIso, entry.percentRemaining, entry.right);
    }
  }

  // Add error rows (rendered as "label: message")
  for (const err of params.errors ?? []) {
    lines.push(`${err.label}: ${err.message}`);
  }

  // Add session token section (if data available and non-empty)
  const tokenLines =
    styleDefinition.sessionTokens === "detailed"
      ? renderSessionTokensLines(params.sessionTokens, { maxWidth })
      : renderSidebarSessionTokenSummaryLines(params.sessionTokens, { maxWidth });
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
