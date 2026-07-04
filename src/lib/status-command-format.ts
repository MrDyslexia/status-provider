/**
 * Verbose status status formatter for /status.
 *
 * This is intentionally more verbose than the toast:
 * - Always shows reset countdown when available
 * - Uses one line per limit, grouped under provider headers
 * - Includes session token summary (input/output per model)
 */

import type { StatusProviderEntry, StatusProviderError, SessionTokensData } from "./entries.js";
import { isValueEntry } from "./entries.js";
import { bar, clampInt, padRight } from "./format-utils.js";
import { formatGroupedHeader } from "./grouped-header-format.js";
import { groupStatusEntries } from "./grouped-entry-normalization.js";
import { renderPlainTextReport, type ReportDocument, type ReportSection } from "./report-document.js";
import { buildSessionTokenSectionModel } from "./session-tokens-format.js";

/**
 * Format reset time in compact form (different from toast countdown).
 * Uses seconds/minutes/hours/days format for /status command.
 */
function formatResetTimeSeconds(diffSeconds: number): string {
  if (!Number.isFinite(diffSeconds) || diffSeconds <= 0) return "now";
  if (diffSeconds < 60) return `${Math.ceil(diffSeconds)}s`;
  if (diffSeconds < 3600) return `${Math.ceil(diffSeconds / 60)}m`;
  if (diffSeconds < 86400) return `${Math.round(diffSeconds / 3600)}h`;
  return `${Math.round(diffSeconds / 86400)}d`;
}

function formatResetsIn(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffSeconds = (t - Date.now()) / 1000;
  return ` (resets in ${formatResetTimeSeconds(diffSeconds)})`;
}

function getGroupedLeftText(entry: StatusProviderEntry): string {
  const label = (entry.label ?? entry.name).trim();
  const right = entry.right?.trim();
  return right ? `${label} ${right}` : label;
}

function buildStatusCommandDocument(params: {
  entries: StatusProviderEntry[];
  errors: StatusProviderError[];
  sessionTokens?: SessionTokensData;
  generatedAtMs?: number;
}): ReportDocument {
  const groups = groupStatusEntries(params.entries, "status");
  const normalizedEntries = groups.flatMap((group) => group.entries);

  const barWidth = 18;
  const leftCol = Math.max(
    16,
    Math.min(
      30,
      normalizedEntries.reduce((max, entry) => Math.max(max, getGroupedLeftText(entry).length), 0),
    ),
  );

  const sections: ReportSection[] = groups.map((group, index) => {
    const lines: string[] = [];
    for (const row of group.entries) {
      const leftText = getGroupedLeftText(row);
      const labelCol = padRight(leftText, leftCol);
      const suffix = formatResetsIn(row.resetTimeIso);

      if (isValueEntry(row)) {
        lines.push(`  ${labelCol} ${row.value}${suffix}`);
        continue;
      }

      const pct = clampInt(row.percentRemaining, 0, 100);
      lines.push(`  ${labelCol} ${bar(pct, barWidth)}  ${pct}% left${suffix}`);
    }
    return {
      id: `group-${index}`,
      title: `→ ${formatGroupedHeader(group.group)}`,
      blocks: [{ kind: "lines", lines }],
    };
  });

  const tokenSection = buildSessionTokenSectionModel(params.sessionTokens);
  if (tokenSection) {
    sections.push({
      id: "session-tokens",
      title: tokenSection.heading,
      blocks: [{ kind: "lines", lines: tokenSection.lines }],
    });
  }

  if (params.errors.length > 0) {
    sections.push({
      id: "errors",
      blocks: [
        {
          kind: "lines",
          lines: params.errors.map((err) => `${err.label}: ${err.message}`),
        },
      ],
    });
  }

  return {
    heading: {
      title: "Status (/status)",
      generatedAtMs: params.generatedAtMs,
    },
    sections,
  };
}

export function formatStatusCommand(params: {
  entries: StatusProviderEntry[];
  errors: StatusProviderError[];
  sessionTokens?: SessionTokensData;
  generatedAtMs?: number;
}): string {
  return renderPlainTextReport(buildStatusCommandDocument(params));
}
