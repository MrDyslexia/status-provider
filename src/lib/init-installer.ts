import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { basename } from "path";

import { writeJsonAtomic } from "./atomic-json.js";
import {
  dedupeNonEmptyStrings,
  extractPluginSpecsFromParsedConfig,
  getPluginSpecFromEntry,
  isStatusPluginSpec,
  resolveEditableConfigPath,
  findGitWorktreeRoot,
  type ConfigFileFormat,
} from "./config-file-utils.js";
import { parseJsonOrJsonc } from "./jsonc.js";
import { getOpencodeRuntimeDirCandidates } from "./opencode-runtime-paths.js";
import {
  STATUS_PROVIDER_SHAPES,
  getStatusProviderDisplayLabel,
  normalizeStatusProviderId,
} from "./provider-metadata.js";
import {
  getStatusFormatStyleLabel,
  isStatusFormatStyle,
  resolveStatusFormatStyle,
  type CanonicalStatusFormatStyle,
} from "./status-format-style.js";
import { getStatusProviderConfigPath, STATUS_PROVIDER_CONFIG_RELATIVE_PATH } from "./config.js";
import type { StatusProviderConfig } from "./types.js";

const STATUS_PLUGIN_SPEC = "status-provider";
const OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json";
const TUI_SCHEMA_URL = "https://opencode.ai/tui.json";
const GITHUB_REPO_URL = "https://github.com/slkiser/status-provider";
const GITHUB_STAR_NOTE = `if this helps, stars are appreciated: ${GITHUB_REPO_URL}`;

export type InitInstallerScope = "project" | "global";
export type InitStatusUiChoice = "toast" | "sidebar" | "compact_status" | "none";
export type InitStatusUi = readonly InitStatusUiChoice[];
export type InitProviderMode = "auto" | "manual";
type InitTuiCompactStatusMode = "off" | "home_bottom" | "home_bottom_session_prompt";

type LegacyInitStatusUi = "toast" | "sidebar" | "toast_sidebar" | "none";
type LegacyInitInstallerSelectionsInput = Omit<InitInstallerSelections, "statusUi"> & {
  statusUi?: InitStatusUi | LegacyInitStatusUi;
  tuiCompactStatus?: InitTuiCompactStatusMode;
};

export interface InitInstallerSelections {
  scope: InitInstallerScope;
  statusUi: InitStatusUi;
  providerMode: InitProviderMode;
  manualProviders: string[];
  formatStyle: CanonicalStatusFormatStyle;
  percentDisplayMode: StatusProviderConfig["percentDisplayMode"];
  showSessionTokens: boolean;
}

export interface InitInstallerQuickSetupNote {
  providerId: string;
  label: string;
  anchor: string;
}

export interface PlannedConfigEdit {
  kind: "opencode" | "tui" | "status";
  path: string;
  existed: boolean;
  format: ConfigFileFormat;
  changed: boolean;
  addedPlugins: string[];
  addedKeys: string[];
  updatedKeys: string[];
  skippedValues: string[];
  warnings: string[];
  nextData?: Record<string, unknown>;
  plannedData?: Record<string, unknown>;
}

export interface InitInstallerPlan {
  selections: InitInstallerSelections;
  baseDir: string;
  edits: PlannedConfigEdit[];
  warnings: string[];
  quickSetupNotes: InitInstallerQuickSetupNote[];
  summaryLines: string[];
}

export interface ApplyInitInstallerPlanResult {
  writtenPaths: string[];
  unchangedPaths: string[];
}

export class InitInstallerError extends Error {
  constructor(
    message: string,
    readonly details?: {
      path?: string;
      writtenPaths?: string[];
    },
  ) {
    super(message);
    this.name = "InitInstallerError";
  }
}

type JsonObject = Record<string, unknown>;

type PromptOption = {
  label: string;
  value: string;
  hint?: string;
};

type NormalizedStatusUiIntent = {
  choices: InitStatusUiChoice[];
  enableToast: boolean;
  installTuiPlugin: boolean;
  enableSidebarPanel: boolean;
  enableCompactStatus: boolean;
};

type PromptAdapter = {
  intro: (message: string) => void;
  outro: (message: string) => void;
  select: (options: { message: string; options: PromptOption[] }) => Promise<unknown>;
  multiselect: (options: {
    message: string;
    required?: boolean;
    options: PromptOption[];
  }) => Promise<unknown>;
  confirm: (options: { message: string; initialValue?: boolean }) => Promise<unknown>;
  isCancel: (value: unknown) => boolean;
  log: {
    info: (message: string) => void;
    success: (message: string) => void;
    error: (message: string) => void;
  };
};

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwnKey<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

const STATUS_UI_CHOICE_ORDER: InitStatusUiChoice[] = [
  "toast",
  "sidebar",
  "compact_status",
  "none",
];

function normalizeStatusUiIntent(selections: InitInstallerSelections): NormalizedStatusUiIntent {
  const legacySelections = selections as LegacyInitInstallerSelectionsInput;
  const statusUi = legacySelections.statusUi ?? [];
  const rawChoices = Array.isArray(statusUi)
    ? statusUi
    : statusUi === "toast_sidebar"
      ? ["toast", "sidebar"]
      : [statusUi];
  const seen = new Set<InitStatusUiChoice>();

  for (const rawChoice of rawChoices) {
    if (typeof rawChoice !== "string" || !STATUS_UI_CHOICE_ORDER.includes(rawChoice as InitStatusUiChoice)) {
      throw new InitInstallerError(`Unknown Status UI option: ${String(rawChoice)}`);
    }
    seen.add(rawChoice as InitStatusUiChoice);
  }

  const legacyCompactMode = legacySelections.tuiCompactStatus;
  if (legacyCompactMode !== undefined && legacyCompactMode !== "off") {
    if (legacyCompactMode !== "home_bottom" && legacyCompactMode !== "home_bottom_session_prompt") {
      throw new InitInstallerError(`Unknown Compact TUI status: ${String(legacyCompactMode)}`);
    }
    seen.delete("none");
    seen.add("compact_status");
  }

  let choices = STATUS_UI_CHOICE_ORDER.filter((choice) => seen.has(choice));
  if (choices.length === 0) {
    choices = ["none"];
  } else if (choices.length > 1 && choices.includes("none")) {
    choices = choices.filter((choice) => choice !== "none");
  }

  const enableSidebarPanel = choices.includes("sidebar");
  const enableCompactStatus = choices.includes("compact_status");

  return {
    choices,
    enableToast: choices.includes("toast"),
    installTuiPlugin: enableSidebarPanel || enableCompactStatus,
    enableSidebarPanel,
    enableCompactStatus,
  };
}

function getUiLabel(choices: readonly InitStatusUiChoice[]): string {
  const labels = choices.map((choice) => {
    if (choice === "toast") return "Toast";
    if (choice === "sidebar") return "Sidebar";
    if (choice === "compact_status") return "Compact status";
    return "None";
  });
  return labels.join(" + ");
}

function getProviderModeLabel(mode: InitProviderMode): string {
  return mode === "manual" ? "Manual" : "Auto-detect";
}

function getPercentDisplayModeLabel(mode: StatusProviderConfig["percentDisplayMode"]): string {
  return mode === "used" ? "Used" : "Remaining";
}

function getTuiCompactStatusLabel(mode: InitTuiCompactStatusMode): string {
  if (mode === "home_bottom") return "Home bottom only";
  if (mode === "home_bottom_session_prompt") return "Home bottom + session prompt";
  return "Off";
}

function resolveRequestedProviders(selections: InitInstallerSelections): string[] | "auto" {
  if (selections.providerMode === "auto") {
    return "auto";
  }

  const normalized = dedupeNonEmptyStrings(
    selections.manualProviders
      .map((providerId) => normalizeStatusProviderId(providerId))
      .filter((providerId) => STATUS_PROVIDER_SHAPES.some((shape) => shape.id === providerId)),
  );

  if (normalized.length === 0) {
    throw new InitInstallerError("Manual provider mode requires at least one supported provider.");
  }

  return normalized;
}

function pickFormatStyleToWrite(params: {
  statusProvider: JsonObject;
  selectedFormatStyle: CanonicalStatusFormatStyle;
}): CanonicalStatusFormatStyle {
  if (isStatusFormatStyle(params.statusProvider.toastStyle)) {
    return resolveStatusFormatStyle(params.statusProvider.toastStyle);
  }

  return params.selectedFormatStyle;
}

function pushSkippedIfChanged(
  edit: PlannedConfigEdit,
  pathLabel: string,
  existingValue: unknown,
  desiredValue: unknown,
): void {
  if (!jsonEqual(existingValue, desiredValue)) {
    edit.skippedValues.push(`${pathLabel} preserved existing value`);
  }
}

function ensureSchema(root: JsonObject, schemaUrl: string, edit: PlannedConfigEdit): void {
  if (!hasOwnKey(root, "$schema")) {
    root.$schema = schemaUrl;
    edit.changed = true;
    edit.addedKeys.push("$schema");
    return;
  }

  pushSkippedIfChanged(edit, "$schema", root.$schema, schemaUrl);
}

function appendStatusPluginIfMissing(params: {
  container: unknown[];
  pathLabel: string;
  kind: "opencode" | "tui";
  edit: PlannedConfigEdit;
}): void {
  const alreadyConfigured = params.container.some((entry) => {
    const spec = getPluginSpecFromEntry(entry);
    return typeof spec === "string" && isStatusPluginSpec(spec, params.kind);
  });

  if (alreadyConfigured) {
    params.edit.skippedValues.push(`${params.pathLabel} already includes ${STATUS_PLUGIN_SPEC}`);
    return;
  }

  params.container.push(STATUS_PLUGIN_SPEC);
  params.edit.changed = true;
  params.edit.addedPlugins.push(`${params.pathLabel}: ${STATUS_PLUGIN_SPEC}`);
}

function ensureTopLevelPluginArray(root: JsonObject, edit: PlannedConfigEdit): unknown[] {
  if (!hasOwnKey(root, "plugin")) {
    const next: unknown[] = [];
    root.plugin = next;
    edit.changed = true;
    return next;
  }

  if (!Array.isArray(root.plugin)) {
    throw new InitInstallerError(
      `Cannot update ${edit.kind} config because plugin is not an array.`,
      { path: edit.path },
    );
  }

  return root.plugin;
}

function ensureTuiPluginArray(
  root: JsonObject,
  edit: PlannedConfigEdit,
): {
  container: unknown[];
  pathLabel: string;
} {
  if (isPlainObject(root.tui) && hasOwnKey(root.tui, "plugin")) {
    const tuiRoot = root.tui as JsonObject;
    if (!Array.isArray(tuiRoot.plugin)) {
      throw new InitInstallerError(
        `Cannot update ${edit.kind} config because tui.plugin is not an array.`,
        { path: edit.path },
      );
    }

    return {
      container: tuiRoot.plugin,
      pathLabel: "tui.plugin",
    };
  }

  if (hasOwnKey(root, "plugin")) {
    if (!Array.isArray(root.plugin)) {
      throw new InitInstallerError(
        `Cannot update ${edit.kind} config because plugin is not an array.`,
        { path: edit.path },
      );
    }

    return {
      container: root.plugin,
      pathLabel: "plugin",
    };
  }

  const next: unknown[] = [];
  root.plugin = next;
  edit.changed = true;
  return {
    container: next,
    pathLabel: "plugin",
  };
}

function addSettingIfMissing(
  target: JsonObject,
  key: string,
  value: unknown,
  pathLabel: string,
  edit: PlannedConfigEdit,
): void {
  if (!hasOwnKey(target, key)) {
    target[key] = value;
    edit.changed = true;
    edit.addedKeys.push(pathLabel);
    return;
  }

  pushSkippedIfChanged(edit, pathLabel, target[key], value);
}

function setInstallerOwnedSetting(
  target: JsonObject,
  key: string,
  value: unknown,
  pathLabel: string,
  edit: PlannedConfigEdit,
): void {
  if (!hasOwnKey(target, key)) {
    target[key] = value;
    edit.changed = true;
    edit.addedKeys.push(pathLabel);
    return;
  }

  if (!jsonEqual(target[key], value)) {
    target[key] = value;
    edit.changed = true;
    edit.updatedKeys.push(pathLabel);
  }
}

function planTuiSidebarPanelConfig(params: {
  statusProvider: JsonObject;
  statusUiIntent: NormalizedStatusUiIntent;
  edit: PlannedConfigEdit;
}): void {
  const pathLabel = "statusProvider.tuiSidebarPanel";
  let tuiSidebarPanel: JsonObject;
  if (!hasOwnKey(params.statusProvider, "tuiSidebarPanel")) {
    tuiSidebarPanel = {};
    params.statusProvider.tuiSidebarPanel = tuiSidebarPanel;
  } else if (isPlainObject(params.statusProvider.tuiSidebarPanel)) {
    tuiSidebarPanel = params.statusProvider.tuiSidebarPanel;
  } else {
    params.edit.warnings.push(`${pathLabel} is not an object; preserved existing value.`);
    return;
  }

  setInstallerOwnedSetting(
    tuiSidebarPanel,
    "enabled",
    params.statusUiIntent.enableSidebarPanel,
    `${pathLabel}.enabled`,
    params.edit,
  );
}

function planTuiCompactStatusConfig(params: {
  statusProvider: JsonObject;
  statusUiIntent: NormalizedStatusUiIntent;
  edit: PlannedConfigEdit;
}): void {
  const hasExistingCompactStatus = hasOwnKey(params.statusProvider, "tuiCompactStatus");
  if (!params.statusUiIntent.enableCompactStatus && !hasExistingCompactStatus) {
    return;
  }

  const pathLabel = "statusProvider.tuiCompactStatus";
  let tuiCompactStatus: JsonObject;
  if (!hasExistingCompactStatus) {
    tuiCompactStatus = {};
    params.statusProvider.tuiCompactStatus = tuiCompactStatus;
  } else if (isPlainObject(params.statusProvider.tuiCompactStatus)) {
    tuiCompactStatus = params.statusProvider.tuiCompactStatus;
  } else {
    params.edit.warnings.push(`${pathLabel} is not an object; preserved existing value.`);
    return;
  }

  setInstallerOwnedSetting(
    tuiCompactStatus,
    "enabled",
    params.statusUiIntent.enableCompactStatus,
    `${pathLabel}.enabled`,
    params.edit,
  );

  if (!params.statusUiIntent.enableCompactStatus) {
    return;
  }

  setInstallerOwnedSetting(tuiCompactStatus, "homeBottom", true, `${pathLabel}.homeBottom`, params.edit);
  setInstallerOwnedSetting(
    tuiCompactStatus,
    "sessionPrompt",
    true,
    `${pathLabel}.sessionPrompt`,
    params.edit,
  );
  setInstallerOwnedSetting(
    tuiCompactStatus,
    "suppressWhenNativeProviderStatus",
    true,
    `${pathLabel}.suppressWhenNativeProviderStatus`,
    params.edit,
  );
}

async function readExistingConfig(params: {
  path: string;
  format: ConfigFileFormat;
}): Promise<JsonObject> {
  try {
    const content = await readFile(params.path, "utf-8");
    const parsed = parseJsonOrJsonc(content, params.format === "jsonc");
    if (!isPlainObject(parsed)) {
      throw new InitInstallerError("Existing config root must be a JSON object.", {
        path: params.path,
      });
    }

    return parsed as JsonObject;
  } catch (error) {
    if (error instanceof InitInstallerError) {
      throw error;
    }

    throw new InitInstallerError(`Failed to parse ${basename(params.path)}.`, {
      path: params.path,
    });
  }
}

function buildQuickSetupNotes(selections: InitInstallerSelections): InitInstallerQuickSetupNote[] {
  if (selections.providerMode !== "manual") {
    return [];
  }

  const requestedProviders = resolveRequestedProviders(selections);
  if (requestedProviders === "auto") {
    return [];
  }

  return requestedProviders
    .map((providerId) => STATUS_PROVIDER_SHAPES.find((shape) => shape.id === providerId))
    .filter((shape): shape is (typeof STATUS_PROVIDER_SHAPES)[number] =>
      Boolean(shape?.quickSetupAnchor && shape.autoSetup === "needs_quick_setup"),
    )
    .map((shape) => ({
      providerId: shape.id,
      label: getStatusProviderDisplayLabel(shape.id),
      anchor: shape.quickSetupAnchor!,
    }));
}

async function planOpencodeEdit(params: {
  selections: InitInstallerSelections;
  baseDir: string;
}): Promise<PlannedConfigEdit> {
  const target = resolveEditableConfigPath({ dir: params.baseDir, kind: "opencode" });
  const edit: PlannedConfigEdit = {
    kind: "opencode",
    path: target.path,
    existed: target.existed,
    format: target.format,
    changed: false,
    addedPlugins: [],
    addedKeys: [],
    updatedKeys: [],
    skippedValues: [],
    warnings:
      target.format === "jsonc"
        ? ["Existing JSONC comments/trailing commas will be stripped."]
        : [],
  };

  const root = target.existed ? await readExistingConfig(target) : {};

  ensureSchema(root, OPENCODE_SCHEMA_URL, edit);

  const plugin = ensureTopLevelPluginArray(root, edit);
  appendStatusPluginIfMissing({
    container: plugin,
    pathLabel: "plugin",
    kind: "opencode",
    edit,
  });

  if (edit.changed) {
    edit.nextData = root;
  }

  return edit;
}

async function planStatusConfigEdit(params: {
  selections: InitInstallerSelections;
  statusUiIntent: NormalizedStatusUiIntent;
  baseDir: string;
}): Promise<PlannedConfigEdit> {
  const path = getStatusProviderConfigPath(params.baseDir);
  const existed = existsSync(path);
  const edit: PlannedConfigEdit = {
    kind: "status",
    path,
    existed,
    format: "json",
    changed: false,
    addedPlugins: [],
    addedKeys: [],
    updatedKeys: [],
    skippedValues: [],
    warnings: [],
  };

  const statusProvider = existed ? await readExistingConfig({ path, format: "json" }) : {};

  if (!existed) {
    edit.changed = true;
    edit.addedKeys.push(STATUS_PROVIDER_CONFIG_RELATIVE_PATH);
  }

  setInstallerOwnedSetting(
    statusProvider,
    "enableToast",
    params.statusUiIntent.enableToast,
    "statusProvider.enableToast",
    edit,
  );
  addSettingIfMissing(
    statusProvider,
    "showSessionTokens",
    params.selections.showSessionTokens,
    "statusProvider.showSessionTokens",
    edit,
  );
  addSettingIfMissing(
    statusProvider,
    "enabledProviders",
    resolveRequestedProviders(params.selections),
    "statusProvider.enabledProviders",
    edit,
  );
  addSettingIfMissing(
    statusProvider,
    "formatStyle",
    pickFormatStyleToWrite({
      statusProvider,
      selectedFormatStyle: params.selections.formatStyle,
    }),
    "statusProvider.formatStyle",
    edit,
  );
  addSettingIfMissing(
    statusProvider,
    "percentDisplayMode",
    params.selections.percentDisplayMode,
    "statusProvider.percentDisplayMode",
    edit,
  );
  planTuiSidebarPanelConfig({
    statusProvider,
    statusUiIntent: params.statusUiIntent,
    edit,
  });
  planTuiCompactStatusConfig({
    statusProvider,
    statusUiIntent: params.statusUiIntent,
    edit,
  });

  edit.plannedData = statusProvider;
  if (edit.changed) {
    edit.nextData = statusProvider;
  }

  return edit;
}

async function planTuiEdit(params: {
  selections: InitInstallerSelections;
  baseDir: string;
}): Promise<PlannedConfigEdit> {
  const target = resolveEditableConfigPath({ dir: params.baseDir, kind: "tui" });
  const edit: PlannedConfigEdit = {
    kind: "tui",
    path: target.path,
    existed: target.existed,
    format: target.format,
    changed: false,
    addedPlugins: [],
    addedKeys: [],
    updatedKeys: [],
    skippedValues: [],
    warnings:
      target.format === "jsonc"
        ? ["Existing JSONC comments/trailing commas will be stripped."]
        : [],
  };

  const root = target.existed ? await readExistingConfig(target) : {};
  ensureSchema(root, TUI_SCHEMA_URL, edit);

  const existingPluginSpecs = extractPluginSpecsFromParsedConfig(root);
  if (existingPluginSpecs.some((spec) => isStatusPluginSpec(spec, "tui"))) {
    edit.skippedValues.push(`tui config already includes ${STATUS_PLUGIN_SPEC}`);
  } else {
    const pluginTarget = ensureTuiPluginArray(root, edit);
    appendStatusPluginIfMissing({
      container: pluginTarget.container,
      pathLabel: pluginTarget.pathLabel,
      kind: "tui",
      edit,
    });
  }

  if (edit.changed) {
    edit.nextData = root;
  }

  return edit;
}

function buildPlanSummary(plan: InitInstallerPlan): string[] {
  const statusUiIntent = normalizeStatusUiIntent(plan.selections);
  const lines: string[] = [
    `Scope: ${plan.selections.scope} (${plan.baseDir})`,
    `Status UI: ${getUiLabel(statusUiIntent.choices)}`,
    `Provider mode: ${getProviderModeLabel(plan.selections.providerMode)}`,
    `Status reset periods: ${getStatusFormatStyleLabel(plan.selections.formatStyle)}`,
    `Status percentage meaning: ${getPercentDisplayModeLabel(plan.selections.percentDisplayMode)}`,
    `Session token details: ${plan.selections.showSessionTokens ? "Show" : "Hide"}`,
  ];

  if (statusUiIntent.enableCompactStatus) {
    lines.push(`Compact status mode: ${getTuiCompactStatusLabel("home_bottom_session_prompt")}`);
  }

  const requestedProviders = resolveRequestedProviders(plan.selections);
  if (requestedProviders !== "auto") {
    lines.push(
      `Manual providers: ${requestedProviders.map((providerId) => getStatusProviderDisplayLabel(providerId)).join(", ")}`,
    );
  }

  for (const edit of plan.edits) {
    const mode = !edit.existed ? "create" : edit.changed ? "update" : "unchanged";
    lines.push(`${mode}: ${edit.path}`);

    for (const plugin of edit.addedPlugins) {
      lines.push(`  + plugin ${plugin}`);
    }
    for (const key of edit.addedKeys) {
      lines.push(`  + ${key}`);
    }
    for (const key of edit.updatedKeys) {
      lines.push(`  ~ ${key}`);
    }
    for (const skipped of edit.skippedValues) {
      lines.push(`  = ${skipped}`);
    }
    for (const warning of edit.warnings) {
      lines.push(`  ! ${warning}`);
    }
  }

  if (plan.quickSetupNotes.length > 0) {
    lines.push("Quick setup reminders:");
    for (const note of plan.quickSetupNotes) {
      lines.push(`  - ${note.label}: README.md#${note.anchor}`);
    }
  }

  if (plan.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of plan.warnings) {
      lines.push(`  ! ${warning}`);
    }
  }

  return lines;
}

export function getInstallerProviderPromptOptions(): PromptOption[] {
  return STATUS_PROVIDER_SHAPES.map((shape) => ({
    label:
      shape.autoSetup === "needs_quick_setup"
        ? `${getStatusProviderDisplayLabel(shape.id)} (quick setup)`
        : getStatusProviderDisplayLabel(shape.id),
    value: shape.id,
  }));
}

export function resolveInitInstallerBaseDir(params: {
  scope: InitInstallerScope;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): string {
  if (params.scope === "global") {
    const candidates = getOpencodeRuntimeDirCandidates({
      env: params.env,
      homeDir: params.homeDir,
    });
    return candidates.configDirs[0]!;
  }

  const cwd = params.cwd ?? process.cwd();
  return findGitWorktreeRoot(cwd) ?? cwd;
}

export async function planInitInstaller(params: {
  selections: InitInstallerSelections;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): Promise<InitInstallerPlan> {
  const statusUiIntent = normalizeStatusUiIntent(params.selections);
  const selections: InitInstallerSelections = {
    ...params.selections,
    statusUi: statusUiIntent.choices,
    manualProviders:
      params.selections.providerMode === "manual"
        ? (resolveRequestedProviders(params.selections) as string[])
        : [],
  };
  const baseDir = resolveInitInstallerBaseDir({
    scope: selections.scope,
    cwd: params.cwd,
    env: params.env,
    homeDir: params.homeDir,
  });
  const statusEdit = await planStatusConfigEdit({ selections, statusUiIntent, baseDir });
  const edits = [
    await planOpencodeEdit({
      selections,
      baseDir,
    }),
    statusEdit,
  ];
  if (statusUiIntent.installTuiPlugin) {
    edits.push(await planTuiEdit({ selections, baseDir }));
  }

  const quickSetupNotes = buildQuickSetupNotes(selections);
  const warnings = edits.flatMap((edit) => edit.warnings);

  const plan: InitInstallerPlan = {
    selections,
    baseDir,
    edits,
    warnings,
    quickSetupNotes,
    summaryLines: [],
  };
  plan.summaryLines = buildPlanSummary(plan);
  return plan;
}

export async function applyInitInstallerPlan(
  plan: InitInstallerPlan,
): Promise<ApplyInitInstallerPlanResult> {
  const writtenPaths: string[] = [];
  const unchangedPaths: string[] = [];

  for (const edit of plan.edits) {
    if (!edit.changed || !edit.nextData) {
      unchangedPaths.push(edit.path);
      continue;
    }

    try {
      await writeJsonAtomic(edit.path, edit.nextData, { trailingNewline: true });
      writtenPaths.push(edit.path);
    } catch (error) {
      throw new InitInstallerError(`Failed writing ${edit.path}.`, {
        path: edit.path,
        writtenPaths,
      });
    }
  }

  return {
    writtenPaths,
    unchangedPaths,
  };
}

async function promptForSelections(
  prompts: PromptAdapter,
): Promise<InitInstallerSelections | null> {
  const scope = await prompts.select({
    message: "Install scope",
    options: [
      { label: "Project config", value: "project", hint: "install only for this repo/worktree" },
      { label: "Global OpenCode config", value: "global", hint: "install for all projects using your global config" },
    ],
  });
  if (prompts.isCancel(scope)) return null;

  const statusUi = await prompts.multiselect({
    message: "Status UI",
    required: true,
    options: [
      { label: "Toast", value: "toast", hint: "popup status summaries after idle/question/compact events" },
      { label: "Sidebar panel", value: "sidebar", hint: "full Status panel in the OpenCode session sidebar" },
      { label: "Compact status line", value: "compact_status", hint: "short status summary in the TUI status area" },
      { label: "Terminal/slash commands only", value: "none", hint: "no toast, sidebar, or compact status UI" },
    ],
  });
  if (prompts.isCancel(statusUi)) return null;
  if (!Array.isArray(statusUi)) {
    throw new InitInstallerError("Status UI requires selected options.");
  }

  const providerMode = await prompts.select({
    message: "Provider mode",
    options: [
      { label: "Auto-detect providers", value: "auto", hint: "recommended; use providers found in your OpenCode/auth setup" },
      { label: "Choose providers manually", value: "manual", hint: "only track the providers you select" },
    ],
  });
  if (prompts.isCancel(providerMode)) return null;

  let manualProviders: string[] = [];
  if (providerMode === "manual") {
    const selected = await prompts.multiselect({
      message: "Manual providers",
      required: true,
      options: getInstallerProviderPromptOptions(),
    });
    if (prompts.isCancel(selected)) return null;
    if (!Array.isArray(selected) || selected.length === 0) {
      throw new InitInstallerError("Manual provider mode requires at least one selected provider.");
    }
    manualProviders = selected.filter((value): value is string => typeof value === "string");
  }

  const formatStyle = await prompts.select({
    message: "Status reset periods",
    options: [
      {
        label: "All reset periods per provider (all windows; compare every tracked reset period)",
        value: "allWindows",
      },
      {
        label: "One reset period per provider (single window; best for quick status checks)",
        value: "singleWindow",
      },
    ],
  });
  if (prompts.isCancel(formatStyle)) return null;

  const percentDisplayMode = await prompts.select({
    message: "Status percentage meaning",
    options: [
      { label: "Remaining status", value: "remaining", hint: "show how much status is left" },
      { label: "Used status", value: "used", hint: "show how much status has been consumed" },
    ],
  });
  if (prompts.isCancel(percentDisplayMode)) return null;

  const showSessionTokens = await prompts.select({
    message: "Session token details",
    options: [
      { label: "Hide session tokens", value: "no", hint: "keep status output shorter" },
      { label: "Show session tokens", value: "yes", hint: "include current session input/output token counts when available" },
    ],
  });
  if (prompts.isCancel(showSessionTokens)) return null;

  return {
    scope: scope as InitInstallerScope,
    statusUi: statusUi.filter((value): value is InitStatusUiChoice => typeof value === "string"),
    providerMode: providerMode as InitProviderMode,
    manualProviders,
    formatStyle: formatStyle as CanonicalStatusFormatStyle,
    percentDisplayMode: percentDisplayMode as StatusProviderConfig["percentDisplayMode"],
    showSessionTokens: showSessionTokens === "yes",
  };
}

export async function runInitInstaller(params?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  prompts?: PromptAdapter;
}): Promise<number> {
  const prompts = params?.prompts ?? ((await import("@clack/prompts")) as unknown as PromptAdapter);

  prompts.intro("Configure status-provider");

  try {
    const selections = await promptForSelections(prompts);
    if (!selections) {
      prompts.outro("Cancelled");
      return 0;
    }

    const plan = await planInitInstaller({
      selections,
      cwd: params?.cwd,
      env: params?.env,
      homeDir: params?.homeDir,
    });

    for (const line of plan.summaryLines) {
      prompts.log.info(line);
    }

    if (!plan.edits.some((edit) => edit.changed)) {
      prompts.outro(`No changes needed — ${GITHUB_STAR_NOTE}`);
      return 0;
    }

    const confirmed = await prompts.confirm({
      message: "Apply these changes?",
      initialValue: true,
    });
    if (prompts.isCancel(confirmed) || !confirmed) {
      prompts.outro("Cancelled");
      return 0;
    }

    const result = await applyInitInstallerPlan(plan);
    for (const path of result.writtenPaths) {
      prompts.log.success(`Wrote ${path}`);
    }
    for (const path of result.unchangedPaths) {
      prompts.log.info(`Unchanged ${path}`);
    }

    if (plan.quickSetupNotes.length > 0) {
      prompts.log.info("Manual quick-setup still needed:");
      for (const note of plan.quickSetupNotes) {
        prompts.log.info(`- ${note.label}: README.md#${note.anchor}`);
      }
    }

    prompts.outro(`Status init complete — ${GITHUB_STAR_NOTE}`);
    return 0;
  } catch (error) {
    if (error instanceof InitInstallerError) {
      prompts.log.error(error.message);
      if (error.details?.writtenPaths?.length) {
        prompts.log.info(`Already written: ${error.details.writtenPaths.join(", ")}`);
      }
    } else {
      prompts.log.error(error instanceof Error ? error.message : String(error));
    }
    prompts.outro("Status init failed");
    return 1;
  }
}
