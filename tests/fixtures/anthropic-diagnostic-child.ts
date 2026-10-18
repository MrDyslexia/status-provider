import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

if (process.argv[2] === "--packed-proof") {
  // Check the real archive against the frozen installed dependency graph.
  // This is not a clean installation or a global plugin edit.
  const sandbox = await fs.mkdtemp(join(tmpdir(), "anthropic-packed-proof-"));
  try {
    execFileSync("bun", ["pm", "pack", "--destination", sandbox], {
      cwd: process.cwd(),
      stdio: "pipe",
      timeout: 30000,
    });
    const archive = join(sandbox, "status-provider-0.3.0.tgz");
    execFileSync("tar", ["-xf", archive, "-C", sandbox], { stdio: "pipe", timeout: 30000 });
    const packageRoot = join(sandbox, "package");
    const manifest = JSON.parse(await fs.readFile(join(packageRoot, "package.json"), "utf8"));
    if (manifest.dependencies["fs-native-extensions"] !== "1.5.1")
      throw new Error("Unpinned packed dependency");
    await fs.symlink(
      join(process.cwd(), "node_modules"),
      join(packageRoot, "node_modules"),
      "junction",
    );
    const proof = join(sandbox, "packed-proof.mjs");
    await fs.writeFile(
      proof,
      `
      import { createRequire } from "node:module";
      import * as fs from "node:fs/promises";
      import { join } from "node:path";
      const modulePath = process.argv[2];
      const root = process.argv[3];
      const { createAnthropicDiagnosticLogger } = await import(modulePath);
      const logger = createAnthropicDiagnosticLogger(() => root);
      logger.log(true, { stage: "http", outcome: "success" });
      await logger.flush();
      const event = JSON.parse((await fs.readFile(join(root, "status-provider", "anthropic-diagnostics.jsonl"), "utf8")).trim());
      if (event.outcome !== "success") throw new Error("Packed logger did not write");
      const require = createRequire(modulePath);
      const loaded = Object.keys(require.cache).filter(p => p.endsWith(".node"));
      if (!loaded.some(p => p.endsWith("fs-native-extensions.node"))) throw new Error("Native prebuild not loaded");
      console.log("Packed logger write/native prebuild: PASS");
    `,
    );
    for (const runtime of ["node", "bun"]) {
      const output = execFileSync(
        runtime,
        [
          proof,
          pathToFileURL(join(packageRoot, "dist", "lib", "anthropic-diagnostic-log.js")).href,
          join(sandbox, runtime),
        ],
        { encoding: "utf8", stdio: "pipe", timeout: 10000 },
      );
      console.log(`${runtime}: ${output.trim()}`);
    }
    console.log(
      "Archive: status-provider-0.3.0.tgz; native prebuild: prebuilds/win32-x64/fs-native-extensions.node",
    );
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true });
  }
} else {
  // Only test-created directories and modules are passed by the parent test.
  const [modulePath, root, mode] = process.argv.slice(2);
  const { createAnthropicDiagnosticLogger } = await import(modulePath);
  const logger = createAnthropicDiagnosticLogger(() => root);

  if (mode === "direct") {
    const native = createRequire(import.meta.url)("./native-proxy.cjs");
    const first = await fs.open(join(root, "direct-addon.lock"), "a+", 0o600);
    const second = await fs.open(join(root, "direct-addon.lock"), "a+", 0o600);
    try {
      if (!native.tryLock(first.fd) || native.tryLock(second.fd))
        throw new Error("Mutual exclusion failed");
      native.unlock(first.fd);
      if (!native.tryLock(second.fd)) throw new Error("Reacquisition failed");
      native.unlock(second.fd);
    } finally {
      await first.close();
      await second.close();
    }
    process.send?.({ completed: true, nativeProof: true });
    process.disconnect?.();
  } else if (mode === "hold" || mode === "rotation") {
    // The sandbox filesystem proxy pauses the actual logger immediately after
    // acquiring its native lock, or after a real rotation rename, before cleanup.
    logger.log(true, { stage: "http", outcome: "success" });
    await logger.flush();
  } else {
    for (let wave = 0; wave < 8; wave++) {
      for (let i = 0; i < 32; i++)
        logger.log(mode !== "disabled", { stage: "http", outcome: "success" });
      await logger.flush();
    }
    process.send?.({ completed: true });
    process.disconnect?.();
  }
}
