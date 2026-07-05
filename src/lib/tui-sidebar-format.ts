import type { StatusRenderData } from "./status-render-data.js";
import type { StatusProviderConfig } from "./types.js";

import { sanitizeStatusRenderData } from "./display-sanitize.js";
import { formatStatusRows } from "./format.js";
import { stripAnsi } from "./format-utils.js";

export const TUI_SIDEBAR_MAX_WIDTH = 36;
export const TUI_SIDEBAR_BAR_MAX_WIDTH = TUI_SIDEBAR_MAX_WIDTH;
export const TUI_SIDEBAR_LAYOUT = {
  maxWidth: TUI_SIDEBAR_MAX_WIDTH,
  barMaxWidth: TUI_SIDEBAR_BAR_MAX_WIDTH,
  narrowAt: TUI_SIDEBAR_MAX_WIDTH,
  tinyAt: 20,
} as const;

export function buildSidebarStatusPanelLines(params: {
  data: StatusRenderData;
  config: Pick<
    StatusProviderConfig,
    | "formatStyle"
    | "percentDisplayMode"
    | "textVariant"
    | "providerNameVariant"
    | "percentVariant"
    | "colorVariant"
    | "alignmentVariant"
  >;
}): string[] {
  const data = sanitizeStatusRenderData(params.data);

  const statusBody = formatStatusRows({
    version: "1.0.0",
    layout: TUI_SIDEBAR_LAYOUT,
    entries: data.entries,
    errors: data.errors,
    style: params.config.formatStyle,
    percentDisplayMode: params.config.percentDisplayMode,
    sessionTokens: data.sessionTokens,
    textVariant: params.config.textVariant,
    providerNameVariant: params.config.providerNameVariant,
    percentVariant: params.config.percentVariant,
    colorVariant: params.config.colorVariant,
    alignmentVariant: params.config.alignmentVariant,
  });
  return statusBody ? statusBody.split("\n").map((line) => stripAnsi(line)) : [];
}
