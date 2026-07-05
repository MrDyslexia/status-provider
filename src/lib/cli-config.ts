import { readFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { findGitWorktreeRoot, getEffectiveConfigRoot } from "./config-file-utils.js";
import { getStatusProviderConfigPath, loadConfig } from "./config.js";
import { writeJsonAtomic } from "./atomic-json.js";
import { getProviders } from "../providers/registry.js";
import {
  getStatusProviderDisplayLabel,
  getStatusProviderShape,
  normalizeStatusProviderId,
} from "./provider-metadata.js";
import { resolveStatusFormatStyle, getStatusFormatStyleLabel } from "./status-format-style.js";
import { formatStatusRows } from "./format.js";
import { TUI_SIDEBAR_LAYOUT, TUI_SIDEBAR_MAX_WIDTH } from "./tui-sidebar-format.js";
import type { StatusProviderConfig } from "./types.js";
import type { StatusProviderEntry } from "./entries.js";

const ESC = "\x1B[";

function disableMouseTracking(): void {
  process.stdout.write(`${ESC}?1000l${ESC}?1002l${ESC}?1003l${ESC}?1006l`);
}

function resetTerminal(): void {
  process.stdout.write(
    `${ESC}?1000l${ESC}?1002l${ESC}?1003l${ESC}?1006l` +
      `${ESC}?25h${ESC}0m${ESC}?1049l${ESC}2J${ESC}H`,
  );
}

export interface RunCliConfigCommandOptions {
  argv?: string[];
  cwd?: string;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

type PromptAdapter = {
  intro: (message: string) => void;
  outro: (message: string) => void;
  cancel: (message: string) => void;
  isCancel: (value: unknown) => boolean;
  confirm: (opts: { message: string; initialValue?: boolean }) => Promise<boolean | symbol>;
  select: <T>(opts: {
    message: string;
    options: Array<{ label: string; value: T; hint?: string }>;
    initialValue?: T;
  }) => Promise<T | symbol>;
  multiselect: <T>(opts: {
    message: string;
    options: Array<{ label: string; value: T; hint?: string }>;
    initialValue?: T[];
    required?: boolean;
  }) => Promise<T[] | symbol>;
  text: (opts: {
    message: string;
    initialValue?: string;
    placeholder?: string;
    validate?: (value: string) => string | void;
  }) => Promise<string | symbol>;
};

interface PendingChanges {
  enabledProviders?: "auto" | string[];
  providerOrder?: string[];
  formatStyle?: string;
  percentDisplayMode?: "remaining" | "used";
  enableToast?: boolean;
  debug?: boolean;
  showSessionTokens?: boolean;
  minIntervalMs?: number;
  toastDurationMs?: number;
  onlyCurrentModel?: boolean;
  textVariant?: StatusProviderConfig["textVariant"];
  providerNameVariant?: StatusProviderConfig["providerNameVariant"];
  percentVariant?: StatusProviderConfig["percentVariant"];
  colorVariant?: StatusProviderConfig["colorVariant"];
  alignmentVariant?: StatusProviderConfig["alignmentVariant"];
  toastTextVariant?: StatusProviderConfig["toastTextVariant"];
  toastProviderNameVariant?: StatusProviderConfig["toastProviderNameVariant"];
  toastPercentVariant?: StatusProviderConfig["toastPercentVariant"];
  toastColorVariant?: StatusProviderConfig["toastColorVariant"];
  toastAlignmentVariant?: StatusProviderConfig["toastAlignmentVariant"];
}

export async function runCliConfigCommand(options: RunCliConfigCommandOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const dryRun = argv.includes("--dry-run") || argv.includes("-n");

  const cwd = resolve(options.cwd ?? process.cwd());
  const roots = resolveCliRoots(cwd);
  const configPath = getStatusProviderConfigPath(roots.configRoot);

  const config = await loadConfig(undefined, undefined, { configRootDir: roots.configRoot });

  const prompts = (await import("@clack/prompts")) as unknown as PromptAdapter;
  const changes: PendingChanges = {};

  try {
    disableMouseTracking();
    prompts.intro("Status Config");

    const currentEnabled =
      config.enabledProviders === "auto"
        ? "auto"
        : config.enabledProviders.map((id) => normalizeStatusProviderId(id));

    const enabledModeRaw = await prompts.select<"auto" | "manual">({
      message: "How should providers be enabled?",
      options: [
        {
          label: "Auto-detect",
          value: "auto",
          hint: "enable providers that are available at runtime",
        },
        {
          label: "Manual list",
          value: "manual",
          hint: "choose exactly which providers to query",
        },
      ],
      initialValue: currentEnabled === "auto" ? "auto" : "manual",
    });

    if (prompts.isCancel(enabledModeRaw)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    const enabledMode = enabledModeRaw as "auto" | "manual";
    let enabledIds: string[] = [];

    if (enabledMode === "manual") {
      const initialEnabled = currentEnabled === "auto" ? [] : currentEnabled;
      const picked = await prompts.multiselect<string>({
        message: "Select enabled providers:",
        options: getProviders().map((p) => ({
          label: getStatusProviderDisplayLabel(p.id),
          value: p.id,
        })),
        initialValue: initialEnabled,
        required: false,
      });

      if (prompts.isCancel(picked)) {
        prompts.cancel("Cancelled.");
        return 0;
      }

      enabledIds = Array.isArray(picked) ? picked : [];
      changes.enabledProviders = enabledIds.length > 0 ? enabledIds : [];
    } else if (config.enabledProviders !== "auto") {
      changes.enabledProviders = "auto";
    }

    const orderModeRaw = await prompts.select<"auto" | "custom">({
      message: "Set provider display order?",
      options: [
        { label: "Default order", value: "auto", hint: "use built-in order" },
        {
          label: "Custom order",
          value: "custom",
          hint: "reorder providers; unlisted providers appended in default order",
        },
      ],
      initialValue: config.providerOrder.length > 0 ? "custom" : "auto",
    });

    if (prompts.isCancel(orderModeRaw)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    const orderMode = orderModeRaw as "auto" | "custom";
    let providerOrder: string[] = [];

    if (orderMode === "custom") {
      const activeIds =
        enabledMode === "auto"
          ? getProviders().map((p) => p.id)
          : enabledIds.length > 0
            ? enabledIds
            : currentEnabled === "auto"
              ? getProviders().map((p) => p.id)
              : currentEnabled;

      const initialOrder = config.providerOrder.length > 0
        ? config.providerOrder.filter((id) => activeIds.includes(id))
        : activeIds;

      const missing = activeIds.filter((id) => !initialOrder.includes(id));
      const fullInitialOrder = [...initialOrder, ...missing];

      const ordered = await runReorderPrompt({
        title: "Ordenar proveedores (space para seleccionar, ↑/↓ para mover, Enter para confirmar)",
        items: fullInitialOrder.map((id) => ({
          id,
          label: getStatusProviderDisplayLabel(id),
        })),
      });

      if (ordered === null) {
        prompts.cancel("Cancelled.");
        return 0;
      }

      providerOrder = ordered;
      changes.providerOrder = providerOrder.length > 0 ? providerOrder : [];
    } else if (config.providerOrder.length > 0) {
      changes.providerOrder = [];
    }

    // Visual settings
    const formatStyleRaw = await prompts.select<"singleWindow" | "allWindows">({
      message: "Format style for status rows?",
      options: [
        { label: "Single window", value: "singleWindow", hint: "collapse each provider to one row" },
        { label: "All windows", value: "allWindows", hint: "show every status window" },
      ],
      initialValue: resolveStatusFormatStyle(config.formatStyle),
    });

    if (prompts.isCancel(formatStyleRaw)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    const formatStyle = formatStyleRaw as "singleWindow" | "allWindows";
    if (formatStyle !== resolveStatusFormatStyle(config.formatStyle)) {
      changes.formatStyle = formatStyle;
    }

    const percentModeRaw = await prompts.select<"remaining" | "used">({
      message: "Percent display mode?",
      options: [
        { label: "Remaining", value: "remaining", hint: "% left" },
        { label: "Used", value: "used", hint: "% consumed" },
      ],
      initialValue: config.percentDisplayMode,
    });

    if (prompts.isCancel(percentModeRaw)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    const percentMode = percentModeRaw as "remaining" | "used";
    if (percentMode !== config.percentDisplayMode) {
      changes.percentDisplayMode = percentMode;
    }

    const enableToast = await prompts.confirm({
      message: "Show popup toasts?",
      initialValue: config.enableToast,
    });

    if (prompts.isCancel(enableToast)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    const enableToastValue = enableToast as boolean;
    if (enableToastValue !== config.enableToast) {
      changes.enableToast = enableToastValue;
    }

    const showSessionTokens = await prompts.confirm({
      message: "Show session input/output tokens in displays?",
      initialValue: config.showSessionTokens,
    });

    if (prompts.isCancel(showSessionTokens)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    const showSessionTokensValue = showSessionTokens as boolean;
    if (showSessionTokensValue !== config.showSessionTokens) {
      changes.showSessionTokens = showSessionTokensValue;
    }

    const onlyCurrentModel = await prompts.confirm({
      message: "Only show status for the current model?",
      initialValue: config.onlyCurrentModel,
    });

    if (prompts.isCancel(onlyCurrentModel)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    const onlyCurrentModelValue = onlyCurrentModel as boolean;
    if (onlyCurrentModelValue !== config.onlyCurrentModel) {
      changes.onlyCurrentModel = onlyCurrentModelValue;
    }

    const debug = await prompts.confirm({
      message: "Enable debug footer?",
      initialValue: config.debug,
    });

    if (prompts.isCancel(debug)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    const debugValue = debug as boolean;
    if (debugValue !== config.debug) {
      changes.debug = debugValue;
    }

    const minIntervalRaw = await prompts.text({
      message: "Minimum interval between toasts (ms):",
      initialValue: String(config.minIntervalMs),
      validate: (value) => {
        const n = Number(value);
        if (Number.isNaN(n) || n < 0) return "Must be a non-negative number";
      },
    });

    if (prompts.isCancel(minIntervalRaw)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    const minIntervalMs = Number(minIntervalRaw);
    if (minIntervalMs !== config.minIntervalMs) {
      changes.minIntervalMs = minIntervalMs;
    }

    const toastDurationRaw = await prompts.text({
      message: "Toast duration (ms):",
      initialValue: String(config.toastDurationMs),
      validate: (value) => {
        const n = Number(value);
        if (Number.isNaN(n) || n < 0) return "Must be a non-negative number";
      },
    });

    if (prompts.isCancel(toastDurationRaw)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    const toastDurationMs = Number(toastDurationRaw);
    if (toastDurationMs !== config.toastDurationMs) {
      changes.toastDurationMs = toastDurationMs;
    }

    // ─── Sidebar & CLI display ──────────────────────────────────────────────
    console.log("\nSidebar & CLI display");
    console.log("─────────────────────");

    const textVariant = await prompts.select<StatusProviderConfig["textVariant"]>({
      message: "Text style for status rows (sidebar & CLI)?",
      options: [
        { label: "Default", value: "default", hint: "name + bar + percent" },
        { label: "Minimal", value: "minimal", hint: "single line per provider" },
        { label: "Emoji", value: "emoji", hint: "status emoji prefix" },
        { label: "Box", value: "box", hint: "box drawing framing" },
      ],
      initialValue: config.textVariant,
    });

    if (prompts.isCancel(textVariant)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    if (textVariant !== config.textVariant) {
      changes.textVariant = textVariant as StatusProviderConfig["textVariant"];
    }

    const providerNameVariant = await prompts.select<StatusProviderConfig["providerNameVariant"]>({
      message: "Provider name style (sidebar & CLI)?",
      options: [
        { label: "Full", value: "full", hint: "e.g. OpenAI" },
        { label: "Short", value: "short", hint: "e.g. OpenAI" },
        { label: "Icon", value: "icon", hint: "symbol + short name" },
      ],
      initialValue: config.providerNameVariant,
    });

    if (prompts.isCancel(providerNameVariant)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    if (providerNameVariant !== config.providerNameVariant) {
      changes.providerNameVariant = providerNameVariant as StatusProviderConfig["providerNameVariant"];
    }

    const percentVariant = await prompts.select<StatusProviderConfig["percentVariant"]>({
      message: "Percent display style (sidebar & CLI)?",
      options: [
        { label: "Number", value: "number", hint: "percentage text only" },
        { label: "Bar", value: "bar", hint: "progress bar only" },
        { label: "Both", value: "both", hint: "bar + percentage" },
      ],
      initialValue: config.percentVariant,
    });

    if (prompts.isCancel(percentVariant)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    if (percentVariant !== config.percentVariant) {
      changes.percentVariant = percentVariant as StatusProviderConfig["percentVariant"];
    }

    const colorVariant = await prompts.select<StatusProviderConfig["colorVariant"]>({
      message: "Color mode (sidebar & CLI)?",
      options: [
        { label: "Auto", value: "auto", hint: "color by remaining status" },
        { label: "None", value: "none", hint: "no colors" },
      ],
      initialValue: config.colorVariant,
    });

    if (prompts.isCancel(colorVariant)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    if (colorVariant !== config.colorVariant) {
      changes.colorVariant = colorVariant as StatusProviderConfig["colorVariant"];
    }

    const alignmentVariant = await prompts.select<StatusProviderConfig["alignmentVariant"]>({
      message: "Row alignment (sidebar & CLI)?",
      options: [
        { label: "Left", value: "left" },
        { label: "Right", value: "right" },
      ],
      initialValue: config.alignmentVariant,
    });

    if (prompts.isCancel(alignmentVariant)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    if (alignmentVariant !== config.alignmentVariant) {
      changes.alignmentVariant = alignmentVariant as StatusProviderConfig["alignmentVariant"];
    }

    // Vista previa del sidebar apenas se termina de configurar (énfasis en el flujo)
    printPreviewBox("Sidebar preview", renderExampleSidebar({ config, changes }), TUI_SIDEBAR_MAX_WIDTH);

    // ─── Toast popup display ────────────────────────────────────────────────
    console.log("\nToast popup display");
    console.log("───────────────────");

    const sidebarTextVariant = "textVariant" in changes ? changes.textVariant! : config.textVariant;
    const sidebarProviderNameVariant =
      "providerNameVariant" in changes ? changes.providerNameVariant! : config.providerNameVariant;
    const sidebarPercentVariant =
      "percentVariant" in changes ? changes.percentVariant! : config.percentVariant;
    const sidebarColorVariant = "colorVariant" in changes ? changes.colorVariant! : config.colorVariant;
    const sidebarAlignmentVariant =
      "alignmentVariant" in changes ? changes.alignmentVariant! : config.alignmentVariant;

    const copyFromSidebar = await prompts.confirm({
      message: "Copy sidebar settings as a starting point for the toast?",
      initialValue: true,
    });

    if (prompts.isCancel(copyFromSidebar)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    const copyFromSidebarValue = copyFromSidebar as boolean;
    const toastTextInitial = copyFromSidebarValue ? sidebarTextVariant : config.toastTextVariant;
    const toastProviderNameInitial = copyFromSidebarValue
      ? sidebarProviderNameVariant
      : config.toastProviderNameVariant;
    const toastPercentInitial = copyFromSidebarValue ? sidebarPercentVariant : config.toastPercentVariant;
    const toastColorInitial = copyFromSidebarValue ? sidebarColorVariant : config.toastColorVariant;
    const toastAlignmentInitial = copyFromSidebarValue
      ? sidebarAlignmentVariant
      : config.toastAlignmentVariant;

    const toastTextVariant = await prompts.select<StatusProviderConfig["toastTextVariant"]>({
      message: "Text style for status rows (toast)?",
      options: [
        { label: "Default", value: "default", hint: "name + bar + percent" },
        { label: "Minimal", value: "minimal", hint: "single line per provider" },
        { label: "Emoji", value: "emoji", hint: "status emoji prefix" },
        { label: "Box", value: "box", hint: "box drawing framing" },
      ],
      initialValue: toastTextInitial,
    });

    if (prompts.isCancel(toastTextVariant)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    if (toastTextVariant !== config.toastTextVariant) {
      changes.toastTextVariant = toastTextVariant as StatusProviderConfig["toastTextVariant"];
    }

    const toastProviderNameVariant = await prompts.select<StatusProviderConfig["toastProviderNameVariant"]>({
      message: "Provider name style (toast)?",
      options: [
        { label: "Full", value: "full", hint: "e.g. OpenAI" },
        { label: "Short", value: "short", hint: "e.g. OpenAI" },
        { label: "Icon", value: "icon", hint: "symbol + short name" },
      ],
      initialValue: toastProviderNameInitial,
    });

    if (prompts.isCancel(toastProviderNameVariant)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    if (toastProviderNameVariant !== config.toastProviderNameVariant) {
      changes.toastProviderNameVariant =
        toastProviderNameVariant as StatusProviderConfig["toastProviderNameVariant"];
    }

    const toastPercentVariant = await prompts.select<StatusProviderConfig["toastPercentVariant"]>({
      message: "Percent display style (toast)?",
      options: [
        { label: "Number", value: "number", hint: "percentage text only" },
        { label: "Bar", value: "bar", hint: "progress bar only" },
        { label: "Both", value: "both", hint: "bar + percentage" },
      ],
      initialValue: toastPercentInitial,
    });

    if (prompts.isCancel(toastPercentVariant)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    if (toastPercentVariant !== config.toastPercentVariant) {
      changes.toastPercentVariant = toastPercentVariant as StatusProviderConfig["toastPercentVariant"];
    }

    const toastColorVariant = await prompts.select<StatusProviderConfig["toastColorVariant"]>({
      message: "Color mode (toast)?",
      options: [
        { label: "Auto", value: "auto", hint: "color by remaining status" },
        { label: "None", value: "none", hint: "no colors" },
      ],
      initialValue: toastColorInitial,
    });

    if (prompts.isCancel(toastColorVariant)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    if (toastColorVariant !== config.toastColorVariant) {
      changes.toastColorVariant = toastColorVariant as StatusProviderConfig["toastColorVariant"];
    }

    const toastAlignmentVariant = await prompts.select<StatusProviderConfig["toastAlignmentVariant"]>({
      message: "Row alignment (toast)?",
      options: [
        { label: "Left", value: "left" },
        { label: "Right", value: "right" },
      ],
      initialValue: toastAlignmentInitial,
    });

    if (prompts.isCancel(toastAlignmentVariant)) {
      prompts.cancel("Cancelled.");
      return 0;
    }

    if (toastAlignmentVariant !== config.toastAlignmentVariant) {
      changes.toastAlignmentVariant = toastAlignmentVariant as StatusProviderConfig["toastAlignmentVariant"];
    }

    // Vista previa del toast apenas se termina de configurar (énfasis en el flujo)
    printPreviewBox(
      "Toast preview",
      renderExampleToast({ config, changes }),
      Math.max(TUI_SIDEBAR_MAX_WIDTH, config.layout.maxWidth),
    );

    const preview = buildPreview({
      config,
      changes,
      configPath,
      dryRun,
    });

    console.log("\n" + preview);

    if (dryRun) {
      prompts.outro("Dry run. No changes saved.");
      return 0;
    }

    if (Object.keys(changes).length === 0) {
      prompts.outro("No changes to save.");
      return 0;
    }

    const confirm = await prompts.confirm({
      message: "Save these changes?",
      initialValue: true,
    });

    if (prompts.isCancel(confirm) || !confirm) {
      prompts.cancel("Changes discarded.");
      return 0;
    }

    await applyChanges({ configPath, config, changes });
    prompts.outro("Saved.");
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    return 1;
  } finally {
    resetTerminal();
  }
}

function resolve(cwd: string): string {
  return cwd;
}

function resolveCliRoots(cwd: string): { workspaceRoot: string; configRoot: string; fallbackDirectory: string } {
  const fallbackDirectory = cwd;
  const worktreeRoot = findGitWorktreeRoot(fallbackDirectory) ?? fallbackDirectory;
  const configRoot = getEffectiveConfigRoot(worktreeRoot);
  return { workspaceRoot: worktreeRoot, configRoot, fallbackDirectory };
}

async function applyChanges(params: {
  configPath: string;
  config: StatusProviderConfig;
  changes: PendingChanges;
}): Promise<void> {
  const existing = await readConfigFile(params.configPath);
  const nextData: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};

  function setOrDelete(key: string, value: unknown, defaultValue: unknown): void {
    if (value === defaultValue) {
      delete nextData[key];
    } else {
      nextData[key] = value;
    }
  }

  const c = params.config;

  if ("enabledProviders" in params.changes) {
    setOrDelete("enabledProviders", params.changes.enabledProviders, "auto");
  }

  if ("providerOrder" in params.changes) {
    const value = params.changes.providerOrder;
    if (!value || value.length === 0) {
      delete nextData.providerOrder;
    } else {
      nextData.providerOrder = value;
    }
  }

  if ("formatStyle" in params.changes) {
    setOrDelete("formatStyle", params.changes.formatStyle, resolveStatusFormatStyle(c.formatStyle));
  }

  if ("percentDisplayMode" in params.changes) {
    setOrDelete("percentDisplayMode", params.changes.percentDisplayMode, c.percentDisplayMode);
  }

  if ("enableToast" in params.changes) {
    setOrDelete("enableToast", params.changes.enableToast, c.enableToast);
  }

  if ("showSessionTokens" in params.changes) {
    setOrDelete("showSessionTokens", params.changes.showSessionTokens, c.showSessionTokens);
  }

  if ("onlyCurrentModel" in params.changes) {
    setOrDelete("onlyCurrentModel", params.changes.onlyCurrentModel, c.onlyCurrentModel);
  }

  if ("debug" in params.changes) {
    setOrDelete("debug", params.changes.debug, c.debug);
  }

  if ("minIntervalMs" in params.changes) {
    setOrDelete("minIntervalMs", params.changes.minIntervalMs, c.minIntervalMs);
  }

  if ("toastDurationMs" in params.changes) {
    setOrDelete("toastDurationMs", params.changes.toastDurationMs, c.toastDurationMs);
  }

  if ("textVariant" in params.changes) {
    setOrDelete("textVariant", params.changes.textVariant, c.textVariant);
  }

  if ("providerNameVariant" in params.changes) {
    setOrDelete("providerNameVariant", params.changes.providerNameVariant, c.providerNameVariant);
  }

  if ("percentVariant" in params.changes) {
    setOrDelete("percentVariant", params.changes.percentVariant, c.percentVariant);
  }

  if ("colorVariant" in params.changes) {
    setOrDelete("colorVariant", params.changes.colorVariant, c.colorVariant);
  }

  if ("alignmentVariant" in params.changes) {
    setOrDelete("alignmentVariant", params.changes.alignmentVariant, c.alignmentVariant);
  }

  if ("toastTextVariant" in params.changes) {
    setOrDelete("toastTextVariant", params.changes.toastTextVariant, c.toastTextVariant);
  }

  if ("toastProviderNameVariant" in params.changes) {
    setOrDelete(
      "toastProviderNameVariant",
      params.changes.toastProviderNameVariant,
      c.toastProviderNameVariant,
    );
  }

  if ("toastPercentVariant" in params.changes) {
    setOrDelete("toastPercentVariant", params.changes.toastPercentVariant, c.toastPercentVariant);
  }

  if ("toastColorVariant" in params.changes) {
    setOrDelete("toastColorVariant", params.changes.toastColorVariant, c.toastColorVariant);
  }

  if ("toastAlignmentVariant" in params.changes) {
    setOrDelete("toastAlignmentVariant", params.changes.toastAlignmentVariant, c.toastAlignmentVariant);
  }

  await writeJsonAtomic(params.configPath, nextData, { trailingNewline: true });
}

/** Prints a boxed preview block with a title and pre-rendered body lines. */
function printPreviewBox(title: string, body: string, width: number): void {
  const divider = "─".repeat(width);
  console.log(`\n┌${divider}┐`);
  console.log(`│${title.padEnd(width - 2)}  │`);
  console.log(`├${divider}┤`);
  for (const line of body.split("\n")) {
    const stripped = line.startsWith("  ") ? line.slice(2) : line;
    console.log(`│ ${stripped.padEnd(width - 2)} │`);
  }
  console.log(`└${divider}┘`);
}

function renderExampleSidebar(params: {
  config: StatusProviderConfig;
  changes: PendingChanges;
}): string {
  const c = params.config;
  const next: StatusProviderConfig = {
    ...c,
    ...(params.changes as unknown as Partial<StatusProviderConfig>),
  };

  const now = new Date();
  const resetA = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
  const resetB = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

  const entries: StatusProviderEntry[] = [
    { name: "Copilot", percentRemaining: 72, resetTimeIso: resetA },
    { name: "OpenAI", percentRemaining: 34, resetTimeIso: resetB },
  ];

  const rendered = formatStatusRows({
    version: "preview",
    layout: TUI_SIDEBAR_LAYOUT,
    entries,
    style: resolveStatusFormatStyle(next.formatStyle),
    percentDisplayMode: next.percentDisplayMode,
    textVariant: next.textVariant,
    providerNameVariant: next.providerNameVariant,
    percentVariant: next.percentVariant,
    colorVariant: next.colorVariant,
    alignmentVariant: next.alignmentVariant,
  });

  return rendered
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function renderExampleToast(params: {
  config: StatusProviderConfig;
  changes: PendingChanges;
}): string {
  const c = params.config;
  const next: StatusProviderConfig = {
    ...c,
    ...(params.changes as unknown as Partial<StatusProviderConfig>),
  };

  const now = new Date();
  const resetA = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
  const resetB = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

  const entries: StatusProviderEntry[] = [
    { name: "Copilot", percentRemaining: 72, resetTimeIso: resetA },
    { name: "OpenAI", percentRemaining: 34, resetTimeIso: resetB },
  ];

  const rendered = formatStatusRows({
    version: "preview",
    layout: next.layout,
    entries,
    style: resolveStatusFormatStyle(next.formatStyle),
    percentDisplayMode: next.percentDisplayMode,
    textVariant: next.toastTextVariant,
    providerNameVariant: next.toastProviderNameVariant,
    percentVariant: next.toastPercentVariant,
    colorVariant: next.toastColorVariant,
    alignmentVariant: next.toastAlignmentVariant,
  });

  return rendered
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function buildPreview(params: {
  config: StatusProviderConfig;
  changes: PendingChanges;
  configPath: string;
  dryRun: boolean;
}): string {
  const lines = [
    "Preview",
    "───────",
    `path: ${params.configPath}`,
    `dryRun: ${params.dryRun ? "yes" : "no"}`,
    "",
  ];

  const c = params.config;

  function section(title: string, entries: Array<[string, string]>): void {
    if (entries.length === 0) return;
    lines.push(`${title}:`);
    for (const [key, value] of entries) {
      lines.push(`  ${key}: ${value}`);
    }
    lines.push("");
  }

  function enabledValue(value: "auto" | string[]): string {
    return value === "auto" ? "auto" : value.join(", ") || "(none)";
  }

  section("current", [
    ["enabledProviders", c.enabledProviders === "auto" ? "auto" : c.enabledProviders.join(", ")],
    ["providerOrder", c.providerOrder.join(", ") || "(default)"],
    ["formatStyle", getStatusFormatStyleLabel(c.formatStyle)],
    ["percentDisplayMode", c.percentDisplayMode],
    ["enableToast", String(c.enableToast)],
    ["showSessionTokens", String(c.showSessionTokens)],
    ["onlyCurrentModel", String(c.onlyCurrentModel)],
    ["debug", String(c.debug)],
    ["minIntervalMs", `${c.minIntervalMs} ms (${Math.round(c.minIntervalMs / 60000)} min)`],
    ["toastDurationMs", `${c.toastDurationMs} ms (${Math.round(c.toastDurationMs / 1000)} sec)`],
    ["textVariant", c.textVariant],
    ["providerNameVariant", c.providerNameVariant],
    ["percentVariant", c.percentVariant],
    ["colorVariant", c.colorVariant],
    ["alignmentVariant", c.alignmentVariant],
    ["toastTextVariant", c.toastTextVariant],
    ["toastProviderNameVariant", c.toastProviderNameVariant],
    ["toastPercentVariant", c.toastPercentVariant],
    ["toastColorVariant", c.toastColorVariant],
    ["toastAlignmentVariant", c.toastAlignmentVariant],
  ]);

  section("new", [
    ["enabledProviders", "enabledProviders" in params.changes ? enabledValue(params.changes.enabledProviders!) : (c.enabledProviders === "auto" ? "auto" : c.enabledProviders.join(", "))],
    ["providerOrder", "providerOrder" in params.changes ? (params.changes.providerOrder!.length > 0 ? params.changes.providerOrder!.join(", ") : "(default)") : (c.providerOrder.join(", ") || "(default)")],
    ["formatStyle", "formatStyle" in params.changes ? getStatusFormatStyleLabel(params.changes.formatStyle!) : getStatusFormatStyleLabel(c.formatStyle)],
    ["percentDisplayMode", "percentDisplayMode" in params.changes ? params.changes.percentDisplayMode! : c.percentDisplayMode],
    ["enableToast", "enableToast" in params.changes ? String(params.changes.enableToast) : String(c.enableToast)],
    ["showSessionTokens", "showSessionTokens" in params.changes ? String(params.changes.showSessionTokens) : String(c.showSessionTokens)],
    ["onlyCurrentModel", "onlyCurrentModel" in params.changes ? String(params.changes.onlyCurrentModel) : String(c.onlyCurrentModel)],
    ["debug", "debug" in params.changes ? String(params.changes.debug) : String(c.debug)],
    ["minIntervalMs", "minIntervalMs" in params.changes ? `${params.changes.minIntervalMs} ms (${Math.round(params.changes.minIntervalMs! / 60000)} min)` : `${c.minIntervalMs} ms (${Math.round(c.minIntervalMs / 60000)} min)`],
    ["toastDurationMs", "toastDurationMs" in params.changes ? `${params.changes.toastDurationMs} ms (${Math.round(params.changes.toastDurationMs! / 1000)} sec)` : `${c.toastDurationMs} ms (${Math.round(c.toastDurationMs / 1000)} sec)`],
    ["textVariant", "textVariant" in params.changes ? params.changes.textVariant! : c.textVariant],
    ["providerNameVariant", "providerNameVariant" in params.changes ? params.changes.providerNameVariant! : c.providerNameVariant],
    ["percentVariant", "percentVariant" in params.changes ? params.changes.percentVariant! : c.percentVariant],
    ["colorVariant", "colorVariant" in params.changes ? params.changes.colorVariant! : c.colorVariant],
    ["alignmentVariant", "alignmentVariant" in params.changes ? params.changes.alignmentVariant! : c.alignmentVariant],
    ["toastTextVariant", "toastTextVariant" in params.changes ? params.changes.toastTextVariant! : c.toastTextVariant],
    ["toastProviderNameVariant", "toastProviderNameVariant" in params.changes ? params.changes.toastProviderNameVariant! : c.toastProviderNameVariant],
    ["toastPercentVariant", "toastPercentVariant" in params.changes ? params.changes.toastPercentVariant! : c.toastPercentVariant],
    ["toastColorVariant", "toastColorVariant" in params.changes ? params.changes.toastColorVariant! : c.toastColorVariant],
    ["toastAlignmentVariant", "toastAlignmentVariant" in params.changes ? params.changes.toastAlignmentVariant! : c.toastAlignmentVariant],
  ]);

  lines.push("example sidebar:");
  lines.push(renderExampleSidebar({ config: c, changes: params.changes }));
  lines.push("");

  lines.push("example toast:");
  lines.push(renderExampleToast({ config: c, changes: params.changes }));
  lines.push("");

  return lines.join("\n");
}

async function readConfigFile(path: string): Promise<unknown> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ReorderItem {
  id: string;
  label: string;
}

async function runReorderPrompt(params: {
  title: string;
  items: ReorderItem[];
}): Promise<string[] | null> {
  return new Promise((resolve) => {
    const items = params.items.map((item) => ({ ...item }));
    let selectedIndex = 0;
    let grabbedIndex: number | null = null;
    let done = false;

    function render(): void {
      const output = [
        "",
        params.title,
        "",
        ...items.map((item, index) => {
          const isSelected = index === selectedIndex;
          const isGrabbed = index === grabbedIndex;
          let marker = " ";
          if (isGrabbed) marker = "✋";
          else if (isSelected) marker = ">";
          return `${marker} ${index + 1}. ${item.label}${isGrabbed ? " (agarrado)" : ""}`;
        }),
        "",
        "Space: agarrar/soltar • ↑/↓: mover cursor • Enter: confirmar • Ctrl+C: cancelar",
        "",
      ];
      stdout.write(`\x1B[2J\x1B[H${output.join("\n")}`);
    }

    function moveCursor(direction: -1 | 1): void {
      const newIndex = selectedIndex + direction;
      if (newIndex < 0 || newIndex >= items.length) return;
      selectedIndex = newIndex;
      if (grabbedIndex !== null) {
        const [moved] = items.splice(grabbedIndex, 1);
        items.splice(selectedIndex, 0, moved);
        grabbedIndex = selectedIndex;
      }
    }

    function cleanup(): void {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\x1B[?25h");
    }

    function onData(buffer: Buffer): void {
      const key = buffer.toString("utf-8");

      if (key === "\x03") {
        // Ctrl+C
        done = true;
        cleanup();
        resolve(null);
        return;
      }

      if (key === "\r" || key === "\n") {
        // Enter
        done = true;
        cleanup();
        resolve(items.map((item) => item.id));
        return;
      }

      if (key === "\x1B[A" || key === "k") {
        // Up arrow or vim 'k'
        moveCursor(-1);
      } else if (key === "\x1B[B" || key === "j") {
        // Down arrow or vim 'j'
        moveCursor(1);
      } else if (key === " ") {
        // Space: grab or release
        if (grabbedIndex === null) {
          grabbedIndex = selectedIndex;
        } else {
          grabbedIndex = null;
        }
      }

      if (!done) render();
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);

    render();
  });
}
