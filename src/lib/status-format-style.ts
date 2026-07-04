export const SINGLE_WINDOW_PER_PROVIDER_FORMAT_STYLE = "singleWindow" as const;
export const ALL_WINDOWS_FORMAT_STYLE = "allWindows" as const;
export const DEFAULT_STATUS_FORMAT_STYLE = SINGLE_WINDOW_PER_PROVIDER_FORMAT_STYLE;

export type CanonicalStatusFormatStyle =
  | typeof SINGLE_WINDOW_PER_PROVIDER_FORMAT_STYLE
  | typeof ALL_WINDOWS_FORMAT_STYLE;

export type StatusFormatStyle = CanonicalStatusFormatStyle | "classic" | "grouped";

export type StatusFormatProjection = "singleWindowPerProvider" | "allWindows";
export type StatusFormatRenderer = "classic" | "grouped";
export type StatusFormatSessionTokens = "summary" | "detailed";

export type StatusFormatStyleDefinition = {
  id: CanonicalStatusFormatStyle;
  aliases: readonly StatusFormatStyle[];
  label: string;
  projection: StatusFormatProjection;
  renderer: StatusFormatRenderer;
  sessionTokens: StatusFormatSessionTokens;
};

const STATUS_FORMAT_STYLE_DEFINITIONS = {
  [SINGLE_WINDOW_PER_PROVIDER_FORMAT_STYLE]: {
    id: SINGLE_WINDOW_PER_PROVIDER_FORMAT_STYLE,
    aliases: [SINGLE_WINDOW_PER_PROVIDER_FORMAT_STYLE, "classic"],
    label: "Single window",
    projection: "singleWindowPerProvider",
    renderer: "classic",
    sessionTokens: "summary",
  },
  [ALL_WINDOWS_FORMAT_STYLE]: {
    id: ALL_WINDOWS_FORMAT_STYLE,
    aliases: [ALL_WINDOWS_FORMAT_STYLE, "grouped"],
    label: "All windows",
    projection: "allWindows",
    renderer: "grouped",
    sessionTokens: "detailed",
  },
} as const satisfies Record<CanonicalStatusFormatStyle, StatusFormatStyleDefinition>;

const STATUS_FORMAT_STYLE_ALIAS_MAP = new Map<StatusFormatStyle, CanonicalStatusFormatStyle>(
  Object.values(STATUS_FORMAT_STYLE_DEFINITIONS).flatMap((definition) =>
    definition.aliases.map((alias) => [alias, definition.id] as const),
  ),
);

export function isStatusFormatStyle(value: unknown): value is StatusFormatStyle {
  return typeof value === "string" && STATUS_FORMAT_STYLE_ALIAS_MAP.has(value as StatusFormatStyle);
}

export function resolveStatusFormatStyle(value: unknown): CanonicalStatusFormatStyle {
  if (!isStatusFormatStyle(value)) {
    return DEFAULT_STATUS_FORMAT_STYLE;
  }

  return STATUS_FORMAT_STYLE_ALIAS_MAP.get(value)!;
}

export function getStatusFormatStyleDefinition(value: unknown): StatusFormatStyleDefinition {
  return STATUS_FORMAT_STYLE_DEFINITIONS[resolveStatusFormatStyle(value)];
}

export function getStatusFormatStyleLabel(value: unknown): string {
  return getStatusFormatStyleDefinition(value).label;
}
