#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runInitInstaller } from "../lib/init-installer.js";

const USAGE = [
  "Usage:",
  "  npx status-provider init",
  "  npx status-provider show [--provider <provider-id>]",
  "  npx status-provider config [--dry-run]",
  "  npx status-provider --help",
  "",
  "Commands:",
  "  init    Run the interactive status-provider installer",
  "  show    Print a quick status glance",
  "  config  Interactive config editor for enabled providers and display order",
  "          --dry-run preview changes without saving",
].join("\n");

function printUsage(): void {
  console.log(USAGE);
}

function resolveCliPath(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch {
    return resolve(filePath);
  }
}

export function cliShouldRunMain(
  argv1: string | undefined = process.argv[1],
  modulePath: string = fileURLToPath(import.meta.url),
  resolvePath: (filePath: string) => string = resolveCliPath,
): boolean {
  if (!argv1) {
    return false;
  }

  return resolvePath(modulePath) === resolvePath(argv1);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv;

  if (!command) {
    printUsage();
    return 1;
  }

  if (command === "--help" || command === "-h" || command === "help") {
    printUsage();
    return 0;
  }

  if (command === "init") {
    // Accept --removed-legacy-sync silently for backward compat with old CLI usage.
    const filteredRest = rest.filter((arg) => arg !== "--removed-legacy-sync");
    if (filteredRest.length === 0) {
      return await runInitInstaller();
    }
  }

  if (command === "show") {
    const { runCliShowCommand } = await import("../lib/cli-show.js");
    return await runCliShowCommand({ argv: rest });
  }

  if (command === "config") {
    const { runCliConfigCommand } = await import("../lib/cli-config.js");
    return await runCliConfigCommand({ argv: rest });
  }

  printUsage();
  return 1;
}

if (cliShouldRunMain()) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
