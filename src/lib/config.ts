/**
 * Configuration loader for status-provider plugin.
 *
 * Precedence model:
 * - Global/user config provides defaults.
 * - Workspace config at the resolved config root overrides ordinary settings.
 * - SDK config is used only as a fallback when no file-backed config exists.
 */

import type {
  CursorStatusPlan,
  StatusProviderConfig,
  GoogleModelId,
  PercentDisplayMode,
  PricingSnapshotSource,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { isStatusFormatStyle, resolveStatusFormatStyle } from "./status-format-style.js";
import { parseJsonOrJsonc } from "./jsonc.js";
import { getStatusProviderShape, normalizeStatusProviderId } from "./provider-metadata.js";

import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";

import { getEffectiveConfigRoot } from "./config-file-utils.js";
import { getOpencodeRuntimeDirCandidates } from "./opencode-runtime-paths.js";

export const STATUS_PROVIDER_CONFIG_RELATIVE_PATH = "status-provider/config.json";

export const STATUS_PROVIDER_SETTING_SOURCE_KEYS = [
  "enabled",
  "enableToast",
  "formatStyle",
  "percentDisplayMode",
  "minIntervalMs",
  "requestTimeoutMs",
  "debug",
  "enabledProviders",
  "providerOrder",
  "textVariant",
  "providerNameVariant",
  "percentVariant",
  "colorVariant",
  "alignmentVariant",
  "anthropicBinaryPath",
  "googleModels",
  "alibabaCodingPlanTier",
  "cursorPlan",
  "cursorIncludedApiUsd",
  "cursorBillingCycleStartDay",
  "opencodeGoWindows",
  "pricingSnapshot.source",
  "pricingSnapshot.autoRefresh",
  "showOnIdle",
  "showOnQuestion",
  "showOnCompact",
  "showOnBothFail",
  "toastDurationMs",
  "onlyCurrentModel",
  "showSessionTokens",
  "tuiSidebarPanel.enabled",
  "tuiCompactStatus.enabled",
  "tuiCompactStatus.homeBottom",
  "tuiCompactStatus.sessionPrompt",
  "tuiCompactStatus.suppressWhenNativeProviderStatus",
  "tuiCompactStatus.maxWidth",
  "layout.maxWidth",
  "layout.narrowAt",
  "layout.tinyAt",
] as const;

export type StatusProviderSettingSourceKey = (typeof STATUS_PROVIDER_SETTING_SOURCE_KEYS)[number];
export type StatusProviderSettingSources = Partial<Record<StatusProviderSettingSourceKey, string>>;

export interface LoadConfigIssue {
  path: string;
  key: string;
  message: string;
}

export interface LoadConfigMeta {
  source: "sdk" | "files" | "defaults";
  paths: string[];
  globalConfigPaths: string[];
  workspaceConfigPaths: string[];
  settingSources: StatusProviderSettingSources;
  networkSettingSources: Record<string, string>;
  configIssues: LoadConfigIssue[];
}

export interface LoadConfigOptions {
  /** @deprecated Prefer configRootDir for new callers. */
  cwd?: string;
  configRootDir?: string;
}

export function createLoadConfigMeta(): LoadConfigMeta {
  return {
    source: "defaults",
    paths: [],
    globalConfigPaths: [],
    workspaceConfigPaths: [],
    settingSources: {},
    networkSettingSources: {},
    configIssues: [],
  };
}

const CONFIG_FILENAMES = ["opencode.json", "opencode.jsonc"] as const;
const NETWORK_SETTING_SOURCE_KEYS = [
  "enabled",
  "enabledProviders",
  "minIntervalMs",
  "requestTimeoutMs",
  "pricingSnapshot.source",
  "pricingSnapshot.autoRefresh",
  "showOnIdle",
  "showOnQuestion",
  "showOnCompact",
  "showOnBothFail",
] as const satisfies readonly StatusProviderSettingSourceKey[];

type PricingSnapshotPatch = Partial<StatusProviderConfig["pricingSnapshot"]>;
type TuiSidebarPanelPatch = Partial<StatusProviderConfig["tuiSidebarPanel"]>;
type TuiCompactStatusPatch = Partial<StatusProviderConfig["tuiCompactStatus"]>;
type LayoutPatch = Partial<StatusProviderConfig["layout"]>;

type ValidatedStatusProviderPatch = {
  enabled?: boolean;
  enableToast?: boolean;
  formatStyle?: StatusProviderConfig["formatStyle"];
  percentDisplayMode?: PercentDisplayMode;
  minIntervalMs?: number;
  requestTimeoutMs?: number;
  debug?: boolean;
  enabledProviders?: string[] | "auto";
  enabledProvidersInvalidEmpty?: boolean;
  providerOrder?: string[];
  textVariant?: StatusProviderConfig["textVariant"];
  providerNameVariant?: StatusProviderConfig["providerNameVariant"];
  percentVariant?: StatusProviderConfig["percentVariant"];
  colorVariant?: StatusProviderConfig["colorVariant"];
  alignmentVariant?: StatusProviderConfig["alignmentVariant"];
  anthropicBinaryPath?: string;
  googleModels?: GoogleModelId[];
  alibabaCodingPlanTier?: StatusProviderConfig["alibabaCodingPlanTier"];
  cursorPlan?: CursorStatusPlan;
  cursorIncludedApiUsd?: number;
  cursorBillingCycleStartDay?: number;
  opencodeGoWindows?: Array<"rolling" | "weekly" | "monthly">;
  pricingSnapshot?: PricingSnapshotPatch;
  showOnIdle?: boolean;
  showOnQuestion?: boolean;
  showOnCompact?: boolean;
  showOnBothFail?: boolean;
  toastDurationMs?: number;
  onlyCurrentModel?: boolean;
  showSessionTokens?: boolean;
  tuiSidebarPanel?: TuiSidebarPanelPatch;
  tuiCompactStatus?: TuiCompactStatusPatch;
  layout?: LayoutPatch;
};

type ConfigLayerScope = "global" | "workspace";
type ConfigLayerKind = "plugin";

interface ConfigLayerCandidate {
  path: string;
  scope: ConfigLayerScope;
  kind: ConfigLayerKind;
  pluginPath: string;
  preferredPluginPath: string;
  relativePathLabel: string;
}

export function getStatusProviderConfigPath(configRootDir: string): string {
  return join(configRootDir, STATUS_PROVIDER_CONFIG_RELATIVE_PATH);
}

function hasOwnKey<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates and normalizes a Google model ID
 */
function isValidGoogleModelId(id: unknown): id is GoogleModelId {
  return typeof id === "string" && ["G3PRO", "G3FLASH", "CLAUDE", "G3IMAGE"].includes(id);
}

function isValidCursorStatusPlan(plan: unknown): plan is CursorStatusPlan {
  return (
    typeof plan === "string" && ["none", "pro", "pro-plus", "ultra"].includes(plan)
  );
}

function isValidPricingSnapshotSource(source: unknown): source is PricingSnapshotSource {
  return typeof source === "string" && ["auto", "bundled", "runtime"].includes(source);
}

function isValidPricingSnapshotAutoRefresh(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isValidPercentDisplayMode(value: unknown): value is PercentDisplayMode {
  return value === "remaining" || value === "used";
}

function isValidTextVariant(value: unknown): value is StatusProviderConfig["textVariant"] {
  return value === "default" || value === "minimal" || value === "box" || value === "emoji";
}

function isValidProviderNameVariant(value: unknown): value is StatusProviderConfig["providerNameVariant"] {
  return value === "full" || value === "short" || value === "icon";
}

function isValidPercentVariant(value: unknown): value is StatusProviderConfig["percentVariant"] {
  return value === "number" || value === "bar" || value === "both";
}

function isValidColorVariant(value: unknown): value is StatusProviderConfig["colorVariant"] {
  return value === "auto" || value === "none";
}

function isValidAlignmentVariant(value: unknown): value is StatusProviderConfig["alignmentVariant"] {
  return value === "left" || value === "right";
}

function isValidAlibabaCodingPlanTier(
  value: unknown,
): value is StatusProviderConfig["alibabaCodingPlanTier"] {
  return value === "lite" || value === "pro";
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isValidCursorBillingCycleStartDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 28;
}

const VALID_OPENCODE_GO_WINDOWS = ["rolling", "weekly", "monthly"] as const;

function isValidOpenCodeGoWindows(value: unknown): value is Array<"rolling" | "weekly" | "monthly"> {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return false;
  return value.every((v) => typeof v === "string" && VALID_OPENCODE_GO_WINDOWS.includes(v as typeof VALID_OPENCODE_GO_WINDOWS[number]));
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function getConfiguredFormatStyle(
  statusProviderConfig: Partial<StatusProviderConfig> | undefined | null,
): StatusProviderConfig["formatStyle"] | undefined {
  if (!statusProviderConfig) {
    return undefined;
  }

  if (isStatusFormatStyle(statusProviderConfig.formatStyle)) {
    return resolveStatusFormatStyle(statusProviderConfig.formatStyle);
  }

  const legacyFormatStyle = (statusProviderConfig as { toastStyle?: unknown }).toastStyle;
  if (isStatusFormatStyle(legacyFormatStyle)) {
    return resolveStatusFormatStyle(legacyFormatStyle);
  }

  return undefined;
}

/**
 * Remove duplicates from an array while preserving order
 */
function dedupe<T>(list: T[]): T[] {
  return [...new Set(list)];
}

function cloneDefaultConfig(): StatusProviderConfig {
  return cloneConfig(DEFAULT_CONFIG);
}

function cloneConfig(config: StatusProviderConfig): StatusProviderConfig {
  return {
    ...config,
    enabledProviders: Array.isArray(config.enabledProviders)
      ? [...config.enabledProviders]
      : config.enabledProviders,
    providerOrder: [...config.providerOrder],
    googleModels: [...config.googleModels],
    opencodeGoWindows: [...config.opencodeGoWindows],
    pricingSnapshot: { ...config.pricingSnapshot },
    tuiSidebarPanel: { ...config.tuiSidebarPanel },
    tuiCompactStatus: { ...config.tuiCompactStatus },
    layout: { ...config.layout },
  };
}

type NormalizedEnabledProviders = {
  value?: string[] | "auto";
  issues: string[];
  invalidEmpty?: boolean;
};

function describeInvalidProviderValue(value: unknown): string {
  return typeof value === "string" ? value : typeof value;
}

function normalizeEnabledProviders(value: unknown): NormalizedEnabledProviders {
  if (value === "auto") {
    return { value: "auto", issues: [] };
  }

  if (!Array.isArray(value)) {
    return {
      value: [],
      issues: ["expected \"auto\" or an array of provider ids"],
      invalidEmpty: true,
    };
  }

  if (value.length === 0) {
    return { value: [], issues: [] };
  }

  const validProviders: string[] = [];
  const invalidProviders: string[] = [];

  for (const provider of value) {
    if (typeof provider !== "string") {
      invalidProviders.push(describeInvalidProviderValue(provider));
      continue;
    }

    const normalized = normalizeStatusProviderId(provider);
    if (normalized && getStatusProviderShape(normalized)) {
      validProviders.push(normalized);
    } else {
      invalidProviders.push(provider);
    }
  }

  const issues = invalidProviders.length
    ? [`unknown provider id(s): ${dedupe(invalidProviders).join(", ")}`]
    : [];

  const normalizedProviders = dedupe(validProviders);
  return {
    value: normalizedProviders,
    issues,
    invalidEmpty: normalizedProviders.length === 0 && invalidProviders.length > 0,
  };
}

function normalizeGoogleModels(value: unknown): GoogleModelId[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const models = value.filter(isValidGoogleModelId);
  return models.length > 0 ? models : undefined;
}

function normalizeProviderOrder(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const validIds: string[] = [];
  const invalidIds: string[] = [];

  for (const provider of value) {
    if (typeof provider !== "string") {
      invalidIds.push(String(provider));
      continue;
    }

    const normalized = normalizeStatusProviderId(provider);
    if (getStatusProviderShape(normalized)) {
      validIds.push(normalized);
    } else {
      invalidIds.push(provider);
    }
  }

  return validIds.length > 0 ? dedupe(validIds) : undefined;
}

function extractPricingSnapshotPatch(value: unknown): PricingSnapshotPatch | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const patch: PricingSnapshotPatch = {};

  if (hasOwnKey(value, "source") && isValidPricingSnapshotSource(value.source)) {
    patch.source = value.source;
  }

  if (hasOwnKey(value, "autoRefresh") && isValidPricingSnapshotAutoRefresh(value.autoRefresh)) {
    patch.autoRefresh = value.autoRefresh;
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
}

function extractTuiSidebarPanelPatch(value: unknown): TuiSidebarPanelPatch | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const patch: TuiSidebarPanelPatch = {};

  if (hasOwnKey(value, "enabled") && typeof value.enabled === "boolean") {
    patch.enabled = value.enabled;
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
}

function extractTuiCompactStatusPatch(value: unknown): TuiCompactStatusPatch | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const patch: TuiCompactStatusPatch = {};

  if (hasOwnKey(value, "enabled") && typeof value.enabled === "boolean") {
    patch.enabled = value.enabled;
  }

  if (hasOwnKey(value, "homeBottom") && typeof value.homeBottom === "boolean") {
    patch.homeBottom = value.homeBottom;
  }

  if (hasOwnKey(value, "sessionPrompt") && typeof value.sessionPrompt === "boolean") {
    patch.sessionPrompt = value.sessionPrompt;
  }

  if (
    hasOwnKey(value, "suppressWhenNativeProviderStatus") &&
    typeof value.suppressWhenNativeProviderStatus === "boolean"
  ) {
    patch.suppressWhenNativeProviderStatus = value.suppressWhenNativeProviderStatus;
  }

  if (hasOwnKey(value, "maxWidth") && isPositiveNumber(value.maxWidth)) {
    patch.maxWidth = value.maxWidth;
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
}

function extractLayoutPatch(value: unknown): LayoutPatch | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const patch: LayoutPatch = {};

  if (hasOwnKey(value, "maxWidth") && isPositiveNumber(value.maxWidth)) {
    patch.maxWidth = value.maxWidth;
  }

  if (hasOwnKey(value, "narrowAt") && isPositiveNumber(value.narrowAt)) {
    patch.narrowAt = value.narrowAt;
  }

  if (hasOwnKey(value, "tinyAt") && isPositiveNumber(value.tinyAt)) {
    patch.tinyAt = value.tinyAt;
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
}

function extractValidatedStatusProviderPatch(
  statusProviderConfig: Record<string, unknown>,
  reportIssue?: (key: string, message: string) => void,
): ValidatedStatusProviderPatch {
  const patch: ValidatedStatusProviderPatch = {};

  if (hasOwnKey(statusProviderConfig, "enabled") && typeof statusProviderConfig.enabled === "boolean") {
    patch.enabled = statusProviderConfig.enabled;
  }

  if (
    hasOwnKey(statusProviderConfig, "enableToast") &&
    typeof statusProviderConfig.enableToast === "boolean"
  ) {
    patch.enableToast = statusProviderConfig.enableToast;
  }

  const formatStyle = getConfiguredFormatStyle(statusProviderConfig as Partial<StatusProviderConfig>);
  if (formatStyle) {
    patch.formatStyle = formatStyle;
  }

  if (
    hasOwnKey(statusProviderConfig, "percentDisplayMode") &&
    isValidPercentDisplayMode(statusProviderConfig.percentDisplayMode)
  ) {
    patch.percentDisplayMode = statusProviderConfig.percentDisplayMode;
  }

  if (hasOwnKey(statusProviderConfig, "minIntervalMs") && isPositiveNumber(statusProviderConfig.minIntervalMs)) {
    patch.minIntervalMs = statusProviderConfig.minIntervalMs;
  }

  if (
    hasOwnKey(statusProviderConfig, "requestTimeoutMs") &&
    isPositiveNumber(statusProviderConfig.requestTimeoutMs)
  ) {
    patch.requestTimeoutMs = statusProviderConfig.requestTimeoutMs;
  }

  if (hasOwnKey(statusProviderConfig, "debug") && typeof statusProviderConfig.debug === "boolean") {
    patch.debug = statusProviderConfig.debug;
  }

  if (hasOwnKey(statusProviderConfig, "enabledProviders")) {
    const enabledProviders = normalizeEnabledProviders(statusProviderConfig.enabledProviders);
    for (const issue of enabledProviders.issues) {
      reportIssue?.("enabledProviders", issue);
    }
    if (enabledProviders.value !== undefined) {
      patch.enabledProviders = enabledProviders.value;
      if (enabledProviders.invalidEmpty) {
        patch.enabledProvidersInvalidEmpty = true;
      }
    }
  }

  if (hasOwnKey(statusProviderConfig, "providerOrder")) {
    const providerOrder = normalizeProviderOrder(statusProviderConfig.providerOrder);
    if (providerOrder !== undefined) {
      patch.providerOrder = providerOrder;
    } else {
      reportIssue?.("providerOrder", "no valid provider ids in providerOrder");
    }
  }

  if (hasOwnKey(statusProviderConfig, "textVariant") && isValidTextVariant(statusProviderConfig.textVariant)) {
    patch.textVariant = statusProviderConfig.textVariant;
  }

  if (
    hasOwnKey(statusProviderConfig, "providerNameVariant") &&
    isValidProviderNameVariant(statusProviderConfig.providerNameVariant)
  ) {
    patch.providerNameVariant = statusProviderConfig.providerNameVariant;
  }

  if (hasOwnKey(statusProviderConfig, "percentVariant") && isValidPercentVariant(statusProviderConfig.percentVariant)) {
    patch.percentVariant = statusProviderConfig.percentVariant;
  }

  if (hasOwnKey(statusProviderConfig, "colorVariant") && isValidColorVariant(statusProviderConfig.colorVariant)) {
    patch.colorVariant = statusProviderConfig.colorVariant;
  }

  if (
    hasOwnKey(statusProviderConfig, "alignmentVariant") &&
    isValidAlignmentVariant(statusProviderConfig.alignmentVariant)
  ) {
    patch.alignmentVariant = statusProviderConfig.alignmentVariant;
  }

  if (hasOwnKey(statusProviderConfig, "anthropicBinaryPath")) {
    const anthropicBinaryPath = normalizeOptionalString(statusProviderConfig.anthropicBinaryPath);
    if (anthropicBinaryPath !== undefined) {
      patch.anthropicBinaryPath = anthropicBinaryPath;
    }
  }

  if (hasOwnKey(statusProviderConfig, "googleModels")) {
    const googleModels = normalizeGoogleModels(statusProviderConfig.googleModels);
    if (googleModels !== undefined) {
      patch.googleModels = googleModels;
    }
  }

  if (
    hasOwnKey(statusProviderConfig, "alibabaCodingPlanTier") &&
    isValidAlibabaCodingPlanTier(statusProviderConfig.alibabaCodingPlanTier)
  ) {
    patch.alibabaCodingPlanTier = statusProviderConfig.alibabaCodingPlanTier;
  }

  if (hasOwnKey(statusProviderConfig, "cursorPlan") && isValidCursorStatusPlan(statusProviderConfig.cursorPlan)) {
    patch.cursorPlan = statusProviderConfig.cursorPlan;
  }

  if (
    hasOwnKey(statusProviderConfig, "cursorIncludedApiUsd") &&
    isPositiveNumber(statusProviderConfig.cursorIncludedApiUsd)
  ) {
    patch.cursorIncludedApiUsd = statusProviderConfig.cursorIncludedApiUsd;
  }

  if (
    hasOwnKey(statusProviderConfig, "cursorBillingCycleStartDay") &&
    isValidCursorBillingCycleStartDay(statusProviderConfig.cursorBillingCycleStartDay)
  ) {
    patch.cursorBillingCycleStartDay = statusProviderConfig.cursorBillingCycleStartDay;
  }

  if (
    hasOwnKey(statusProviderConfig, "opencodeGoWindows") &&
    isValidOpenCodeGoWindows(statusProviderConfig.opencodeGoWindows)
  ) {
    patch.opencodeGoWindows = statusProviderConfig.opencodeGoWindows;
  }

  if (hasOwnKey(statusProviderConfig, "pricingSnapshot")) {
    const pricingSnapshot = extractPricingSnapshotPatch(statusProviderConfig.pricingSnapshot);
    if (pricingSnapshot) {
      patch.pricingSnapshot = pricingSnapshot;
    }
  }

  if (hasOwnKey(statusProviderConfig, "showOnIdle") && typeof statusProviderConfig.showOnIdle === "boolean") {
    patch.showOnIdle = statusProviderConfig.showOnIdle;
  }

  if (
    hasOwnKey(statusProviderConfig, "showOnQuestion") &&
    typeof statusProviderConfig.showOnQuestion === "boolean"
  ) {
    patch.showOnQuestion = statusProviderConfig.showOnQuestion;
  }

  if (
    hasOwnKey(statusProviderConfig, "showOnCompact") &&
    typeof statusProviderConfig.showOnCompact === "boolean"
  ) {
    patch.showOnCompact = statusProviderConfig.showOnCompact;
  }

  if (
    hasOwnKey(statusProviderConfig, "showOnBothFail") &&
    typeof statusProviderConfig.showOnBothFail === "boolean"
  ) {
    patch.showOnBothFail = statusProviderConfig.showOnBothFail;
  }

  if (
    hasOwnKey(statusProviderConfig, "toastDurationMs") &&
    isPositiveNumber(statusProviderConfig.toastDurationMs)
  ) {
    patch.toastDurationMs = statusProviderConfig.toastDurationMs;
  }

  if (
    hasOwnKey(statusProviderConfig, "onlyCurrentModel") &&
    typeof statusProviderConfig.onlyCurrentModel === "boolean"
  ) {
    patch.onlyCurrentModel = statusProviderConfig.onlyCurrentModel;
  }

  if (
    hasOwnKey(statusProviderConfig, "showSessionTokens") &&
    typeof statusProviderConfig.showSessionTokens === "boolean"
  ) {
    patch.showSessionTokens = statusProviderConfig.showSessionTokens;
  }

  if (hasOwnKey(statusProviderConfig, "tuiSidebarPanel")) {
    const tuiSidebarPanel = extractTuiSidebarPanelPatch(statusProviderConfig.tuiSidebarPanel);
    if (tuiSidebarPanel) {
      patch.tuiSidebarPanel = tuiSidebarPanel;
    }
  }

  if (hasOwnKey(statusProviderConfig, "tuiCompactStatus")) {
    const tuiCompactStatus = extractTuiCompactStatusPatch(statusProviderConfig.tuiCompactStatus);
    if (tuiCompactStatus) {
      patch.tuiCompactStatus = tuiCompactStatus;
    }
  }

  if (hasOwnKey(statusProviderConfig, "layout")) {
    const layout = extractLayoutPatch(statusProviderConfig.layout);
    if (layout) {
      patch.layout = layout;
    }
  }

  return patch;
}

function applySettingSource(
  settingSources: StatusProviderSettingSources,
  key: StatusProviderSettingSourceKey,
  sourcePath: string,
): void {
  settingSources[key] = sourcePath;
}

function applyValidatedStatusProviderPatch(
  config: StatusProviderConfig,
  patch: ValidatedStatusProviderPatch,
  sourcePath: string,
  settingSources: StatusProviderSettingSources,
): void {
  if (hasOwnKey(patch, "enabled")) {
    config.enabled = patch.enabled!;
    applySettingSource(settingSources, "enabled", sourcePath);
  }

  if (hasOwnKey(patch, "enableToast")) {
    config.enableToast = patch.enableToast!;
    applySettingSource(settingSources, "enableToast", sourcePath);
  }

  if (hasOwnKey(patch, "formatStyle")) {
    config.formatStyle = patch.formatStyle!;
    applySettingSource(settingSources, "formatStyle", sourcePath);
  }

  if (hasOwnKey(patch, "percentDisplayMode")) {
    config.percentDisplayMode = patch.percentDisplayMode!;
    applySettingSource(settingSources, "percentDisplayMode", sourcePath);
  }

  if (hasOwnKey(patch, "minIntervalMs")) {
    config.minIntervalMs = patch.minIntervalMs!;
    applySettingSource(settingSources, "minIntervalMs", sourcePath);
  }

  if (hasOwnKey(patch, "requestTimeoutMs")) {
    config.requestTimeoutMs = patch.requestTimeoutMs!;
    applySettingSource(settingSources, "requestTimeoutMs", sourcePath);
  }

  if (hasOwnKey(patch, "debug")) {
    config.debug = patch.debug!;
    applySettingSource(settingSources, "debug", sourcePath);
  }

  if (hasOwnKey(patch, "enabledProviders")) {
    if (!(patch.enabledProvidersInvalidEmpty && settingSources.enabledProviders)) {
      config.enabledProviders =
        patch.enabledProviders === "auto" ? "auto" : [...patch.enabledProviders!];
      applySettingSource(settingSources, "enabledProviders", sourcePath);
    }
  }

  if (hasOwnKey(patch, "providerOrder")) {
    config.providerOrder = [...patch.providerOrder!];
    applySettingSource(settingSources, "providerOrder", sourcePath);
  }

  if (hasOwnKey(patch, "textVariant")) {
    config.textVariant = patch.textVariant!;
    applySettingSource(settingSources, "textVariant", sourcePath);
  }

  if (hasOwnKey(patch, "providerNameVariant")) {
    config.providerNameVariant = patch.providerNameVariant!;
    applySettingSource(settingSources, "providerNameVariant", sourcePath);
  }

  if (hasOwnKey(patch, "percentVariant")) {
    config.percentVariant = patch.percentVariant!;
    applySettingSource(settingSources, "percentVariant", sourcePath);
  }

  if (hasOwnKey(patch, "colorVariant")) {
    config.colorVariant = patch.colorVariant!;
    applySettingSource(settingSources, "colorVariant", sourcePath);
  }

  if (hasOwnKey(patch, "alignmentVariant")) {
    config.alignmentVariant = patch.alignmentVariant!;
    applySettingSource(settingSources, "alignmentVariant", sourcePath);
  }

  if (hasOwnKey(patch, "anthropicBinaryPath")) {
    config.anthropicBinaryPath = patch.anthropicBinaryPath!;
    applySettingSource(settingSources, "anthropicBinaryPath", sourcePath);
  }

  if (hasOwnKey(patch, "googleModels")) {
    config.googleModels = [...patch.googleModels!];
    applySettingSource(settingSources, "googleModels", sourcePath);
  }

  if (hasOwnKey(patch, "alibabaCodingPlanTier")) {
    config.alibabaCodingPlanTier = patch.alibabaCodingPlanTier!;
    applySettingSource(settingSources, "alibabaCodingPlanTier", sourcePath);
  }

  if (hasOwnKey(patch, "cursorPlan")) {
    config.cursorPlan = patch.cursorPlan!;
    applySettingSource(settingSources, "cursorPlan", sourcePath);
  }

  if (hasOwnKey(patch, "cursorIncludedApiUsd")) {
    config.cursorIncludedApiUsd = patch.cursorIncludedApiUsd;
    applySettingSource(settingSources, "cursorIncludedApiUsd", sourcePath);
  }

  if (hasOwnKey(patch, "cursorBillingCycleStartDay")) {
    config.cursorBillingCycleStartDay = patch.cursorBillingCycleStartDay;
    applySettingSource(settingSources, "cursorBillingCycleStartDay", sourcePath);
  }

  if (hasOwnKey(patch, "opencodeGoWindows")) {
    config.opencodeGoWindows = [...patch.opencodeGoWindows!];
    applySettingSource(settingSources, "opencodeGoWindows", sourcePath);
  }

  if (patch.pricingSnapshot) {
    if (hasOwnKey(patch.pricingSnapshot, "source")) {
      config.pricingSnapshot.source = patch.pricingSnapshot.source!;
      applySettingSource(settingSources, "pricingSnapshot.source", sourcePath);
    }

    if (hasOwnKey(patch.pricingSnapshot, "autoRefresh")) {
      config.pricingSnapshot.autoRefresh = patch.pricingSnapshot.autoRefresh!;
      applySettingSource(settingSources, "pricingSnapshot.autoRefresh", sourcePath);
    }
  }

  if (hasOwnKey(patch, "showOnIdle")) {
    config.showOnIdle = patch.showOnIdle!;
    applySettingSource(settingSources, "showOnIdle", sourcePath);
  }

  if (hasOwnKey(patch, "showOnQuestion")) {
    config.showOnQuestion = patch.showOnQuestion!;
    applySettingSource(settingSources, "showOnQuestion", sourcePath);
  }

  if (hasOwnKey(patch, "showOnCompact")) {
    config.showOnCompact = patch.showOnCompact!;
    applySettingSource(settingSources, "showOnCompact", sourcePath);
  }

  if (hasOwnKey(patch, "showOnBothFail")) {
    config.showOnBothFail = patch.showOnBothFail!;
    applySettingSource(settingSources, "showOnBothFail", sourcePath);
  }

  if (hasOwnKey(patch, "toastDurationMs")) {
    config.toastDurationMs = patch.toastDurationMs!;
    applySettingSource(settingSources, "toastDurationMs", sourcePath);
  }

  if (hasOwnKey(patch, "onlyCurrentModel")) {
    config.onlyCurrentModel = patch.onlyCurrentModel!;
    applySettingSource(settingSources, "onlyCurrentModel", sourcePath);
  }

  if (hasOwnKey(patch, "showSessionTokens")) {
    config.showSessionTokens = patch.showSessionTokens!;
    applySettingSource(settingSources, "showSessionTokens", sourcePath);
  }

  if (patch.tuiSidebarPanel) {
    if (hasOwnKey(patch.tuiSidebarPanel, "enabled")) {
      config.tuiSidebarPanel.enabled = patch.tuiSidebarPanel.enabled!;
      applySettingSource(settingSources, "tuiSidebarPanel.enabled", sourcePath);
    }
  }

  if (patch.tuiCompactStatus) {
    if (hasOwnKey(patch.tuiCompactStatus, "enabled")) {
      config.tuiCompactStatus.enabled = patch.tuiCompactStatus.enabled!;
      applySettingSource(settingSources, "tuiCompactStatus.enabled", sourcePath);
    }

    if (hasOwnKey(patch.tuiCompactStatus, "homeBottom")) {
      config.tuiCompactStatus.homeBottom = patch.tuiCompactStatus.homeBottom!;
      applySettingSource(settingSources, "tuiCompactStatus.homeBottom", sourcePath);
    }

    if (hasOwnKey(patch.tuiCompactStatus, "sessionPrompt")) {
      config.tuiCompactStatus.sessionPrompt = patch.tuiCompactStatus.sessionPrompt!;
      applySettingSource(settingSources, "tuiCompactStatus.sessionPrompt", sourcePath);
    }

    if (hasOwnKey(patch.tuiCompactStatus, "suppressWhenNativeProviderStatus")) {
      config.tuiCompactStatus.suppressWhenNativeProviderStatus =
        patch.tuiCompactStatus.suppressWhenNativeProviderStatus!;
      applySettingSource(
        settingSources,
        "tuiCompactStatus.suppressWhenNativeProviderStatus",
        sourcePath,
      );
    }

    if (hasOwnKey(patch.tuiCompactStatus, "maxWidth")) {
      config.tuiCompactStatus.maxWidth = patch.tuiCompactStatus.maxWidth!;
      applySettingSource(settingSources, "tuiCompactStatus.maxWidth", sourcePath);
    }
  }

  if (patch.layout) {
    if (hasOwnKey(patch.layout, "maxWidth")) {
      config.layout.maxWidth = patch.layout.maxWidth!;
      applySettingSource(settingSources, "layout.maxWidth", sourcePath);
    }

    if (hasOwnKey(patch.layout, "narrowAt")) {
      config.layout.narrowAt = patch.layout.narrowAt!;
      applySettingSource(settingSources, "layout.narrowAt", sourcePath);
    }

    if (hasOwnKey(patch.layout, "tinyAt")) {
      config.layout.tinyAt = patch.layout.tinyAt!;
      applySettingSource(settingSources, "layout.tinyAt", sourcePath);
    }
  }
}

function projectNetworkSettingSources(
  settingSources: StatusProviderSettingSources,
): Record<string, string> {
  const projected: Record<string, string> = {};

  for (const key of NETWORK_SETTING_SOURCE_KEYS) {
    const source = settingSources[key];
    if (typeof source === "string" && source.length > 0) {
      projected[key] = source;
    }
  }

  return projected;
}

function buildConfigLayerCandidatesForRoot(
  dir: string,
  scope: ConfigLayerScope,
): ConfigLayerCandidate[] {
  const pluginPath = getStatusProviderConfigPath(dir);
  return [
    {
      path: pluginPath,
      scope,
      kind: "plugin" as const,
      pluginPath,
      preferredPluginPath: pluginPath,
      relativePathLabel: STATUS_PROVIDER_CONFIG_RELATIVE_PATH,
    },
  ];
}

function buildConfigLayerCandidates(
  configDirs: string[],
  configRootDir: string,
): ConfigLayerCandidate[] {
  const workspaceCandidates = buildConfigLayerCandidatesForRoot(configRootDir, "workspace");
  const workspacePaths = new Set(workspaceCandidates.map((candidate) => candidate.path));
  const globalCandidates = configDirs.flatMap((dir) =>
    buildConfigLayerCandidatesForRoot(dir, "global"),
  );

  return [
    ...globalCandidates.filter((candidate) => !workspacePaths.has(candidate.path)),
    ...workspaceCandidates,
  ];
}

function getConfigLayerSourceLabel(candidate: ConfigLayerCandidate): string {
  return `${candidate.path} (${candidate.relativePathLabel})`;
}

/**
 * Load plugin configuration from OpenCode config
 *
 * @param client - Optional OpenCode SDK client fallback
 * @returns Merged configuration with defaults
 */
export async function loadConfig(
  client:
    | {
        config: {
          get: () => Promise<{
            data?: { experimental?: { statusProvider?: Partial<StatusProviderConfig> } };
          }>;
        };
      }
    | undefined,
  meta?: LoadConfigMeta,
  options?: LoadConfigOptions,
): Promise<StatusProviderConfig> {
  async function readJson(path: string): Promise<unknown | null> {
    try {
      const content = await readFile(path, "utf-8");
      return parseJsonOrJsonc(content, path.endsWith(".jsonc"));
    } catch {
      return null;
    }
  }

  async function loadFromFiles(): Promise<{
    config: StatusProviderConfig | null;
    usedPaths: string[];
    globalConfigPaths: string[];
    workspaceConfigPaths: string[];
    settingSources: StatusProviderSettingSources;
    networkSettingSources: Record<string, string>;
    configIssues: LoadConfigIssue[];
  }> {
    const configRootDir = options?.configRootDir ?? getEffectiveConfigRoot(options?.cwd ?? process.cwd());
    const { configDirs } = getOpencodeRuntimeDirCandidates();
    const config = cloneDefaultConfig();
    const usedPaths: string[] = [];
    const globalConfigPaths: string[] = [];
    const workspaceConfigPaths: string[] = [];
    const settingSources: StatusProviderSettingSources = {};
    const configIssues: LoadConfigIssue[] = [];

    for (const candidate of buildConfigLayerCandidates(configDirs, configRootDir)) {
      if (!existsSync(candidate.path)) {
        continue;
      }

      const parsed = await readJson(candidate.path);
      if (!isPlainObject(parsed)) {
        if (candidate.kind === "plugin") {
          const sourcePath = getConfigLayerSourceLabel(candidate);
          usedPaths.push(sourcePath);
          if (candidate.scope === "global") {
            globalConfigPaths.push(sourcePath);
          } else {
            workspaceConfigPaths.push(sourcePath);
          }
          configIssues.push({
            path: sourcePath,
            key: "$root",
            message: "expected readable JSON object",
          });
        }
        continue;
      }

      const extractedStatusProvider = parsed;
      if (!isPlainObject(extractedStatusProvider)) {
        continue;
      }

      const sourcePath = getConfigLayerSourceLabel(candidate);
      usedPaths.push(sourcePath);
      if (candidate.scope === "global") {
        globalConfigPaths.push(sourcePath);
      } else {
        workspaceConfigPaths.push(sourcePath);
      }

      applyValidatedStatusProviderPatch(
        config,
        extractValidatedStatusProviderPatch(extractedStatusProvider, (key, message) => {
          configIssues.push({ path: sourcePath, key, message });
        }),
        sourcePath,
        settingSources,
      );
    }

    if (usedPaths.length === 0) {
      return {
        config: null,
        usedPaths: [],
        globalConfigPaths: [],
        workspaceConfigPaths: [],
        settingSources: {},
        networkSettingSources: {},
        configIssues: [],
      };
    }

    return {
      config,
      usedPaths,
      globalConfigPaths,
      workspaceConfigPaths,
      settingSources,
      networkSettingSources: projectNetworkSettingSources(settingSources),
      configIssues,
    };
  }

  const fileConfig = await loadFromFiles();
  if (fileConfig.config) {
    if (meta) {
      meta.source = "files";
      meta.paths = fileConfig.usedPaths;
      meta.globalConfigPaths = fileConfig.globalConfigPaths;
      meta.workspaceConfigPaths = fileConfig.workspaceConfigPaths;
      meta.settingSources = fileConfig.settingSources;
      meta.networkSettingSources = fileConfig.networkSettingSources;
      meta.configIssues = fileConfig.configIssues;
    }
    return fileConfig.config;
  }

  if (client) {
    try {
      const response = await client.config.get();

      // OpenCode config schema is strict; plugin-specific config must live under
      // experimental.* to avoid "unrecognized key" validation errors.
      const statusProviderConfig = (response.data as any)?.experimental?.statusProvider;

      if (isPlainObject(statusProviderConfig)) {
        const config = cloneDefaultConfig();
        const settingSources: StatusProviderSettingSources = {};
        const configIssues: LoadConfigIssue[] = [];
        applyValidatedStatusProviderPatch(
          config,
          extractValidatedStatusProviderPatch(statusProviderConfig, (key, message) => {
            configIssues.push({ path: "client.config.get", key, message });
          }),
          "client.config.get",
          settingSources,
        );

        if (meta) {
          meta.source = "sdk";
          meta.paths = ["client.config.get"];
          meta.globalConfigPaths = [];
          meta.workspaceConfigPaths = [];
          meta.settingSources = settingSources;
          meta.networkSettingSources = projectNetworkSettingSources(settingSources);
          meta.configIssues = configIssues;
        }

        return config;
      }
    } catch {
      // ignore; fall back to defaults below
    }
  }

  if (meta) {
    meta.source = "defaults";
    meta.paths = [];
    meta.globalConfigPaths = [];
    meta.workspaceConfigPaths = [];
    meta.settingSources = {};
    meta.networkSettingSources = {};
    meta.configIssues = [];
  }
  return cloneDefaultConfig();
}
