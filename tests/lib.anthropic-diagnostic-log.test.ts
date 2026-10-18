import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
vi.mock("fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("fs/promises")>()),
}));
import { tmpdir } from "os";
import { join } from "path";
import { fork, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
const native = createRequire(import.meta.url)("fs-native-extensions") as {
  tryLock(fd: number): boolean;
  unlock(fd: number): void;
};
import {
  createAnthropicDiagnosticLogger,
  ANTHROPIC_DIAGNOSTIC_MAX_BYTES,
} from "../src/lib/anthropic-diagnostic-log.js";

describe("Anthropic diagnostic JSONL", () => {
  let root: string;
  let path: string;
  const children = new Set<ChildProcess>();

  async function childModule(): Promise<string> {
    const source = await fs.readFile(
      new URL("../src/lib/anthropic-diagnostic-log.ts", import.meta.url),
      "utf8",
    );
    // Compile the actual logger with the installed TypeScript compiler. The
    // default resolver is unreachable because every child supplies its sandbox.
    const code = ts.transpileModule(
      source
        .replace('import * as fs from "fs/promises";', 'import * as fs from "./fs-proxy.mjs";')
        .replace('require("fs-native-extensions")', 'require("./native-proxy.cjs")')
        .replace(
          'import { getOpencodeRuntimeDirs } from "./opencode-runtime-paths.js";',
          'function getOpencodeRuntimeDirs() { throw new Error("sandbox resolver required"); }',
        ),
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
    ).outputText;
    const modulePath = join(root, "logger.mjs");
    await fs.writeFile(modulePath, code);
    await fs.writeFile(
      join(root, "fs-proxy.mjs"),
      `
      export * from "node:fs/promises";
      import { lstat as realLstat, rename as realRename } from "node:fs/promises";
      async function pause() {
        process.send({ acquired: true });
        await new Promise(() => setInterval(() => {}, 1000));
      }
      export async function lstat(...args) {
        if (process.argv[4] === "hold" && globalThis.__testLocked) {
          await pause();
        }
        return realLstat(...args);
      }
      export async function rename(...args) {
        await realRename(...args);
        if (process.argv[4] === "rotation" && globalThis.__testLocked) {
          await pause();
        }
      }
    `,
    );
    await fs.writeFile(
      join(root, "native-proxy.cjs"),
      `
      const native = require(${JSON.stringify(createRequire(import.meta.url).resolve("fs-native-extensions"))});
      if (process.argv[4] === "unavailable" || process.argv[4] === "disabled") {
        throw new Error("Unsupported addon test canary");
      }
      exports.tryLock = (fd) => {
        const granted = native.tryLock(fd);
        globalThis.__testLocked = granted;
        return granted;
      };
      exports.unlock = (fd) => {
        globalThis.__testLocked = false;
        return native.unlock(fd);
      };
    `,
    );
    const fixture = await fs.readFile(
      new URL("./fixtures/anthropic-diagnostic-child.ts", import.meta.url),
      "utf8",
    );
    await fs.writeFile(
      join(root, "child.mjs"),
      ts.transpileModule(fixture, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      }).outputText,
    );
    return pathToFileURL(modulePath).href;
  }

  function startChild(
    modulePath: string,
    mode: string,
    runtime = "node",
  ): {
    child: ChildProcess;
    ready: Promise<unknown>;
    exited: Promise<void>;
  } {
    const child = fork(join(root, "child.mjs"), [modulePath, root, mode], {
      execPath: runtime,
      execArgv: [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    children.add(child);
    const exited = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Test child exit timeout")), 10000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        children.delete(child);
        if (code === 0 || signal === "SIGKILL") resolve();
        else reject(new Error(`Test child exited: ${code}/${signal}`));
      });
    });
    const ready = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Test child readiness timeout")), 5000);
      child.once("message", (message) => {
        clearTimeout(timeout);
        resolve(message);
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    return { child, ready, exited };
  }
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), "anthropic-diagnostics-"));
    path = join(root, "status-provider", "anthropic-diagnostics.jsonl");
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      [...children].map(
        (child) =>
          new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Test child cleanup timeout")), 5000);
            child.once("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
            child.kill("SIGKILL");
          }),
      ),
    );
    await fs.rm(root, { recursive: true, force: true });
  });

  it("handles actual Node process contention and rotation without corrupting records", async () => {
    const modulePath = await childModule();
    await fs.mkdir(join(root, "status-provider"));
    await fs.writeFile(path, "x".repeat(ANTHROPIC_DIAGNOSTIC_MAX_BYTES));
    const writers = Array.from({ length: 4 }, () => startChild(modulePath, "write"));
    await Promise.all(
      writers.map(async (writer) => {
        await writer.ready;
        await writer.exited;
      }),
    );
    const records = (await fs.readFile(path, "utf8")).trim().split("\n");
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) expect(JSON.parse(record).outcome).toBe("success");
    expect((await fs.stat(path + ".1")).size).toBe(ANTHROPIC_DIAGNOSTIC_MAX_BYTES);
    expect((await fs.stat(path)).size).toBeLessThanOrEqual(ANTHROPIC_DIAGNOSTIC_MAX_BYTES);
  }, 15000);

  it.each(["node", "bun"])(
    "%s resumes capture after native lock-owner termination",
    async (runtime) => {
      const modulePath = await childModule();
      const owner = startChild(modulePath, "hold", runtime);
      await owner.ready;
      expect((await fs.stat(path + ".lock")).size).toBe(0);
      const contender = startChild(modulePath, "write", runtime);
      await contender.ready;
      await contender.exited;
      await expect(fs.readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect((await fs.stat(path + ".lock")).size).toBe(0);
      owner.child.kill("SIGKILL");
      await owner.exited;
      const writers = Array.from({ length: 4 }, () => startChild(modulePath, "write", runtime));
      await Promise.all(
        writers.map(async (writer) => {
          await writer.ready;
          await writer.exited;
        }),
      );
      await expect(fs.readFile(path, "utf8")).resolves.toContain('"outcome":"success"');
    },
    15000,
  );

  it.each(["node", "bun"])(
    "%s recovers after termination during rotation",
    async (runtime) => {
      const modulePath = await childModule();
      await fs.mkdir(join(root, "status-provider"));
      for (const suffix of ["", ".1", ".2"]) {
        await fs.writeFile(path + suffix, "x".repeat(ANTHROPIC_DIAGNOSTIC_MAX_BYTES));
      }
      const owner = startChild(modulePath, "rotation", runtime);
      await owner.ready;
      // Pause after .1 becomes .2, leaving active full and .1 absent.
      await expect(fs.stat(path + ".1")).rejects.toMatchObject({ code: "ENOENT" });
      owner.child.kill("SIGKILL");
      await owner.exited;
      const writer = startChild(modulePath, "write", runtime);
      await writer.ready;
      await writer.exited;
      const records = (await fs.readFile(path, "utf8")).trim().split("\n");
      for (const line of records) expect(JSON.parse(line).outcome).toBe("success");
      for (const suffix of ["", ".1"]) {
        expect((await fs.stat(path + suffix)).size).toBeLessThanOrEqual(
          ANTHROPIC_DIAGNOSTIC_MAX_BYTES,
        );
      }
      // Best-effort rotation can discard a rotated file after interrupted renames;
      // it must resume valid bounded writes, not reconstruct lost evidence.
      expect((await fs.readdir(join(root, "status-provider"))).sort()).toEqual([
        "anthropic-diagnostics.jsonl",
        "anthropic-diagnostics.jsonl.1",
        "anthropic-diagnostics.jsonl.lock",
      ]);
    },
    15000,
  );

  it.each(["node", "bun"])(
    "%s directly acquires, rejects contention, unlocks and reacquires the addon",
    async (runtime) => {
      const modulePath = await childModule();
      const child = startChild(modulePath, "direct", runtime);
      expect(await child.ready).toEqual({ completed: true, nativeProof: true });
      await child.exited;
    },
    15000,
  );

  it("reuses unknown legacy sentinel bytes without interpreting or deleting them", async () => {
    await fs.mkdir(join(root, "status-provider"));
    await fs.writeFile(path + ".lock", "partial-unknown-owner");
    const logger = createAnthropicDiagnosticLogger(() => root);
    logger.log(true, { stage: "http", outcome: "success" });
    await logger.flush();
    expect(await fs.readFile(path + ".lock", "utf8")).toBe("partial-unknown-owner");
    expect(await fs.readFile(path, "utf8")).not.toContain("partial-unknown-owner");
  });

  it.each(["node", "bun"])(
    "%s loads the addon lazily and isolates unsupported loading",
    async (runtime) => {
      const modulePath = await childModule();
      for (const mode of ["disabled", "unavailable"]) {
        const writer = startChild(modulePath, mode, runtime);
        await writer.ready;
        await writer.exited;
        await expect(fs.stat(join(root, "status-provider"))).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
    },
    15000,
  );

  it("uses native mutual exclusion across independent descriptors and always closes after unlock failure", async () => {
    await fs.mkdir(join(root, "status-provider"));
    const first = await fs.open(path + ".lock", "a+", 0o600);
    const second = await fs.open(path + ".lock", "a+", 0o600);
    try {
      expect(native.tryLock(first.fd)).toBe(true);
      expect(native.tryLock(second.fd)).toBe(false);
      native.unlock(first.fd);
      expect(native.tryLock(second.fd)).toBe(true);
      native.unlock(second.fd);
    } finally {
      await first.close();
      await second.close();
    }
    const logger = createAnthropicDiagnosticLogger(() => root);
    const failedLock = vi.spyOn(native, "tryLock").mockImplementationOnce(() => {
      throw new Error("native lock canary");
    });
    logger.log(true, { stage: "http", outcome: "error" });
    await expect(logger.flush()).resolves.toBeUndefined();
    failedLock.mockRestore();
    const unlock = vi.spyOn(native, "unlock").mockImplementationOnce(() => {
      throw new Error("unlock canary");
    });
    logger.log(true, { stage: "http", outcome: "success" });
    await expect(logger.flush()).resolves.toBeUndefined();
    unlock.mockRestore();
    const probe = await fs.open(path + ".lock", "a+");
    try {
      expect(native.tryLock(probe.fd)).toBe(true);
      native.unlock(probe.fd);
    } finally {
      await probe.close();
    }
  });

  it("has no filesystem side effects while disabled", async () => {
    const logger = createAnthropicDiagnosticLogger(() => {
      throw new Error("must not resolve");
    });
    logger.log(false, { stage: "http", outcome: "success" });
    await logger.flush();
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("copies only runtime-validated fields and never raw canary data", async () => {
    const logger = createAnthropicDiagnosticLogger(() => root);
    const canary = "secret-token-account-path-body-canary";
    logger.log(true, {
      stage: "http",
      outcome: "network",
      source: canary,
      httpStatus: 503,
      durationMs: 12,
      retryAfterMs: Infinity,
      attempted: true,
      hasData: false,
      error: new Error(canary),
      token: canary,
      headers: { Authorization: canary },
      payload: { canary },
      runId: canary,
      timestamp: canary,
      cacheKey: canary,
    } as any);
    logger.log(true, { stage: canary, outcome: "success" } as any);
    logger.log(true, { stage: "http", outcome: canary } as any);
    let reads = 0;
    logger.log(true, {
      get stage() {
        return reads++ ? canary : "http";
      },
      outcome: "success",
    } as any);
    await logger.flush();
    const raw = await fs.readFile(path, "utf8");
    expect(raw).not.toContain(canary);
    const events = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      schemaVersion: 1,
      stage: "http",
      outcome: "network",
      httpStatus: 503,
      durationMs: 12,
      attempted: true,
      hasData: false,
    });
    expect(events[0].timestamp).toMatch(/Z$/);
    expect(events[0].runId).toMatch(/^[a-f0-9-]{36}$/);
    expect(events[0]).not.toHaveProperty("source");
    expect(events[0]).not.toHaveProperty("retryAfterMs");
  });

  it("bounds the queue without making callers wait for filesystem work", async () => {
    const logger = createAnthropicDiagnosticLogger(() => root);
    for (let i = 0; i < 10_000; i++) {
      expect(logger.log(true, { stage: "http", outcome: "success" })).toBeUndefined();
    }
    await logger.flush();
    expect((await fs.readFile(path, "utf8")).trim().split("\n").length).toBeLessThanOrEqual(128);
  });

  it("rotates only two bounded files and prunes old records opportunistically", async () => {
    await fs.mkdir(join(root, "status-provider"));
    const logger = createAnthropicDiagnosticLogger(() => root);
    for (let i = 0; i < 4; i++) {
      await fs.writeFile(path, "x".repeat(ANTHROPIC_DIAGNOSTIC_MAX_BYTES));
      logger.log(true, { stage: "http", outcome: "success" });
      await logger.flush();
    }
    expect((await fs.readdir(join(root, "status-provider"))).sort()).toEqual([
      "anthropic-diagnostics.jsonl",
      "anthropic-diagnostics.jsonl.1",
      "anthropic-diagnostics.jsonl.2",
      "anthropic-diagnostics.jsonl.lock",
    ]);
    for (const suffix of ["", ".1", ".2"]) {
      expect((await fs.stat(path + suffix)).size).toBeLessThanOrEqual(
        ANTHROPIC_DIAGNOSTIC_MAX_BYTES,
      );
      await fs.writeFile(
        path + suffix,
        JSON.stringify({ timestamp: "2000-01-01T00:00:00.000Z" }) + "\n",
      );
    }
    logger.log(true, { stage: "http", outcome: "success" });
    await logger.flush();
    expect(await fs.readdir(join(root, "status-provider"))).toEqual([
      "anthropic-diagnostics.jsonl",
      "anthropic-diagnostics.jsonl.lock",
    ]);
    expect(await fs.readFile(path, "utf8")).not.toContain("2000-01-01");
  });

  it("serializes independent writers through an exclusive lock, dropping contention safely", async () => {
    await fs.mkdir(join(root, "status-provider"));
    await fs.writeFile(path, "x".repeat(ANTHROPIC_DIAGNOSTIC_MAX_BYTES));
    const writers = Array.from({ length: 4 }, () => createAnthropicDiagnosticLogger(() => root));
    for (let wave = 0; wave < 4; wave++) {
      for (const writer of writers) writer.log(true, { stage: "http", outcome: "success" });
      await Promise.all(writers.map((writer) => writer.flush()));
    }
    const records = (await fs.readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.length).toBeGreaterThanOrEqual(4);
    expect(records.length).toBeLessThanOrEqual(16);
    expect((await fs.stat(path + ".1")).size).toBe(ANTHROPIC_DIAGNOSTIC_MAX_BYTES);
    expect((await fs.readdir(join(root, "status-provider"))).sort()).toEqual([
      "anthropic-diagnostics.jsonl",
      "anthropic-diagnostics.jsonl.1",
      "anthropic-diagnostics.jsonl.lock",
    ]);
    const holder = await fs.open(path + ".lock", "a+");
    try {
      expect(native.tryLock(holder.fd)).toBe(true);
      writers[0].log(true, { stage: "http", outcome: "error" });
      await writers[0].flush();
      expect((await fs.readFile(path, "utf8")).trim().split("\n")).toHaveLength(records.length);
    } finally {
      native.unlock(holder.fd);
      await holder.close();
    }
  });

  it("isolates permission and rotation failures and releases owned locks", async () => {
    const logger = createAnthropicDiagnosticLogger(() => root);
    const mkdir = vi.spyOn(fs, "mkdir").mockRejectedValueOnce(new Error("EACCES canary"));
    logger.log(true, { stage: "http", outcome: "success" });
    await expect(logger.flush()).resolves.toBeUndefined();
    mkdir.mockRestore();
    await fs.mkdir(join(root, "status-provider"));
    await fs.writeFile(path, "x".repeat(ANTHROPIC_DIAGNOSTIC_MAX_BYTES));
    const rename = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("EACCES canary"));
    logger.log(true, { stage: "http", outcome: "success" });
    await expect(logger.flush()).resolves.toBeUndefined();
    expect((await fs.stat(path)).size).toBe(ANTHROPIC_DIAGNOSTIC_MAX_BYTES);
    expect(await fs.readdir(join(root, "status-provider"))).toContain(
      "anthropic-diagnostics.jsonl.lock",
    );
    rename.mockRestore();
    logger.log(true, { stage: "http", outcome: "success" });
    await logger.flush();
    expect(JSON.parse((await fs.readFile(path, "utf8")).trim()).outcome).toBe("success");
  });
});
