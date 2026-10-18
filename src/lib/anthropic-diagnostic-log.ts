import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import { join } from "path";
import { createRequire } from "node:module";
import { getOpencodeRuntimeDirs } from "./opencode-runtime-paths.js";

export const ANTHROPIC_DIAGNOSTIC_MAX_BYTES = 1024 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QUEUE = 128;
const MAX_EVENT_BYTES = 512;
const BATCH_SIZE = 32;
const require = createRequire(import.meta.url);

const STAGES = [
  "availability",
  "local-cli",
  "credentials",
  "http",
  "rotated-token",
  "local-cache",
  "diagnostics-cache",
  "query",
  "shared-cache",
] as const;
const OUTCOMES = [
  "success",
  "error",
  "network",
  "timeout",
  "server-error",
  "http-error",
  "unauthorized",
  "forbidden",
  "rate-limited",
  "parse-error",
  "response-shape",
  "credential-unavailable",
  "configured",
  "not-found",
  "auth-expired",
  "auth-refreshing",
  "no-auth",
  "no-access-token",
  "no-refresh-token",
  "ok",
  "unavailable",
  "authenticated",
  "unauthenticated",
  "unknown",
  "rotated",
  "unchanged",
  "auth-stale",
  "hit",
  "miss",
  "expiry",
  "bypass",
  "dedup",
  "unattempted-deletion",
  "stale-fallback",
  "recovery",
] as const;
const SOURCES = [
  "local-cli",
  "opencode",
  "keychain",
  "claude-file",
  "memory",
  "persisted",
] as const;

export interface AnthropicDiagnosticEvent {
  stage: (typeof STAGES)[number];
  outcome: (typeof OUTCOMES)[number];
  source?: (typeof SOURCES)[number];
  durationMs?: number;
  httpStatus?: number;
  attempted?: boolean;
  hasData?: boolean;
  retryAfterMs?: number;
  remainingTtlMs?: number;
}

/** Construct a new object: unknown fields, enum strings and non-finite values never reach disk. */
function encodeEvent(event: AnthropicDiagnosticEvent, runId: string): string | null {
  if (!event) return null;
  const stage = event.stage;
  const outcome = event.outcome;
  const source = event.source;
  if (!STAGES.includes(stage) || !OUTCOMES.includes(outcome)) return null;
  const safe: Record<string, string | number | boolean> = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId,
    stage,
    outcome,
  };
  if (source && SOURCES.includes(source)) safe.source = source;
  for (const key of ["attempted", "hasData"] as const) {
    const value = event[key];
    if (typeof value === "boolean") safe[key] = value;
  }
  for (const key of ["durationMs", "retryAfterMs", "remainingTtlMs", "httpStatus"] as const) {
    const value = event[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    if (key === "httpStatus" && (!Number.isInteger(value) || value < 100 || value > 599)) continue;
    safe[key] = Math.min(Math.round(value), 2_147_483_647);
  }
  const line = JSON.stringify(safe) + "\n";
  return Buffer.byteLength(line) <= MAX_EVENT_BYTES ? line : null;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

async function fileSize(path: string): Promise<number> {
  try {
    const info = await fs.lstat(path);
    if (!info.isFile()) throw new Error("Not a regular diagnostic file");
    return info.size;
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
}

async function pruneOldFile(path: string): Promise<void> {
  if ((await fileSize(path)) === 0) return;
  const handle = await fs.open(path, "r");
  let oldest: number = NaN;
  try {
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const first = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0];
    try {
      const timestamp: unknown = (JSON.parse(first) as { timestamp?: unknown }).timestamp;
      if (typeof timestamp === "string") oldest = Date.parse(timestamp);
    } catch {
      // Unknown/partial records are still bounded by rotation, not interpreted as evidence.
    }
  } finally {
    await handle.close();
  }
  if (Date.now() - oldest > RETENTION_MS) await fs.rm(path, { force: true });
}

/** Independent instances use the same exclusive filesystem lock (also shared by server/TUI). */
export function createAnthropicDiagnosticLogger(
  resolveStateDir: () => string = () => getOpencodeRuntimeDirs().stateDir,
): {
  log: (enabled: boolean | undefined, event: AnthropicDiagnosticEvent) => void;
  flush: () => Promise<void>;
} {
  const queue: string[] = [];
  let runId: string | undefined;
  let draining: Promise<void> | undefined;

  async function writeBatch(lines: string[]): Promise<void> {
    // Load only for enabled queued work. Unsupported native addons fail inside
    // the best-effort drain, never during plugin startup or quota requests.
    const { tryLock, unlock } = require("fs-native-extensions") as {
      tryLock: (fd: number) => boolean;
      unlock: (fd: number) => void;
    };
    const dir = join(resolveStateDir(), "status-provider");
    const path = join(dir, "anthropic-diagnostics.jsonl");
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    if (!(await fs.lstat(dir)).isDirectory()) return;
    // The persistent sentinel is never deleted or rotated. The kernel owns the
    // lock, including termination cleanup; an empty legacy lock is reusable.
    const lock = await fs.open(path + ".lock", "a+", 0o600);
    let locked = false;
    try {
      locked = tryLock(lock.fd);
      if (!locked) return; // Nonblocking, one attempt: drop contention.
      for (const suffix of ["", ".1", ".2"]) await pruneOldFile(path + suffix);
      const text = lines.join("");
      if ((await fileSize(path)) + Buffer.byteLength(text) > ANTHROPIC_DIAGNOSTIC_MAX_BYTES) {
        await fs.rm(path + ".2", { force: true });
        if ((await fileSize(path + ".1")) > 0) await fs.rename(path + ".1", path + ".2");
        if ((await fileSize(path)) > 0) await fs.rename(path, path + ".1");
      }
      await fs.appendFile(path, text, { encoding: "utf8", mode: 0o600 });
    } finally {
      try {
        if (locked) unlock(lock.fd);
      } finally {
        await lock.close(); // Also releases ownership if explicit unlock throws.
      }
    }
  }

  return {
    log(enabled, event) {
      if (enabled !== true || queue.length >= MAX_QUEUE) return;
      try {
        runId ??= randomUUID();
        const line = encodeEvent(event, runId);
        if (!line) return;
        queue.push(line);
        draining ??= Promise.resolve().then(async () => {
          try {
            while (queue.length) {
              const batch = queue.splice(0, BATCH_SIZE);
              try {
                await writeBatch(batch);
              } catch {
                /* Best effort; never log logger failures. */
              }
            }
          } finally {
            draining = undefined;
          }
        });
      } catch {
        // Malformed runtime input must not affect a quota result either.
      }
    },
    async flush() {
      await draining;
    },
  };
}

const logger = createAnthropicDiagnosticLogger();
export const logAnthropicDiagnostic = logger.log;
