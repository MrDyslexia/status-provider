import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const moduleMocks = vi.hoisted(() => ({
  resolveImpl: vi.fn<(specifier: string, options?: { paths?: string[] }) => string>(),
  runtimeDirs: {
    value: {
      cacheDirs: [] as string[],
    },
  },
}));

vi.mock("node:module", () => ({
  createRequire: () => ({
    resolve: moduleMocks.resolveImpl,
  }),
}));

vi.mock("../src/lib/opencode-runtime-paths.js", () => ({
  getOpencodeRuntimeDirCandidates: () => moduleMocks.runtimeDirs.value,
}));

function moduleNotFound(): Error & { code?: string } {
  const error = new Error("Cannot find module");
  error.code = "MODULE_NOT_FOUND";
  return error;
}

function packagePathNotExported(): Error & { code?: string } {
  const error = new Error('Package subpath is not defined by "exports"');
  error.code = "ERR_PACKAGE_PATH_NOT_EXPORTED";
  return error;
}

function writeGeminiCredentials(
  path: string,
  params?: { declaration?: "export const" | "const" | "var" },
): void {
  const declaration = params?.declaration ?? "export const";
  writeFileSync(
    path,
    [
      `${declaration} GEMINI_CLIENT_ID = 'client-id';`,
      `${declaration} GEMINI_CLIENT_SECRET = 'client-secret';`,
    ].join("\n"),
    "utf8",
  );
}

describe("google gemini cli companion resolution", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    moduleMocks.resolveImpl.mockReset();
    moduleMocks.runtimeDirs.value = { cacheDirs: [] };
    tempDir = mkdtempSync(join(tmpdir(), "status-provider-gemini-companion-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports missing when the companion package cannot be resolved", async () => {
    moduleMocks.resolveImpl.mockImplementation(() => {
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-gemini-cli-companion.js");

    await expect(mod.inspectGeminiCliCompanionPresence()).resolves.toMatchObject({
      state: "missing",
    });
    await expect(mod.resolveGeminiCliClientCredentials()).resolves.toMatchObject({
      state: "missing",
    });
  });

  it("reads credentials from the published source constants file", async () => {
    const constantsPath = join(tempDir, "constants.ts");
    writeFileSync(
      constantsPath,
      [
        "export const GEMINI_CLIENT_ID = 'client-id';",
        "export const GEMINI_CLIENT_SECRET = 'client-secret';",
      ].join("\n"),
      "utf8",
    );
    moduleMocks.resolveImpl.mockImplementation((specifier) => {
      if (specifier === "opencode-gemini-auth/src/constants.ts") {
        return constantsPath;
      }
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-gemini-cli-companion.js");

    await expect(mod.inspectGeminiCliCompanionPresence()).resolves.toMatchObject({
      state: "present",
      resolvedPath: constantsPath,
    });
    await expect(mod.resolveGeminiCliClientCredentials()).resolves.toMatchObject({
      state: "configured",
      clientId: "client-id",
      clientSecret: "client-secret",
      resolvedPath: constantsPath,
    });
  });

  it("reads credentials from the bundled dist file", async () => {
    const packageRoot = join(tempDir, "opencode-gemini-auth");
    const packageJsonPath = join(packageRoot, "package.json");
    const distPath = join(packageRoot, "dist", "index.js");
    mkdirSync(join(packageRoot, "dist"), { recursive: true });
    writeFileSync(packageJsonPath, JSON.stringify({ name: "opencode-gemini-auth" }), "utf8");
    writeFileSync(
      distPath,
      [
        "var GEMINI_CLIENT_ID = 'dist-client-id';",
        "var GEMINI_CLIENT_SECRET = 'dist-client-secret';",
      ].join("\n"),
      "utf8",
    );
    moduleMocks.resolveImpl.mockImplementation((specifier) => {
      if (specifier === "opencode-gemini-auth/package.json") {
        return packageJsonPath;
      }
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-gemini-cli-companion.js");

    await expect(mod.resolveGeminiCliClientCredentials()).resolves.toMatchObject({
      state: "configured",
      clientId: "dist-client-id",
      clientSecret: "dist-client-secret",
      resolvedPath: distPath,
    });
  });

  it("falls through package export blocks and reads credentials from the package root export", async () => {
    const packageRoot = join(tempDir, "opencode-gemini-auth");
    const distPath = join(packageRoot, "dist", "index.js");
    mkdirSync(join(packageRoot, "dist"), { recursive: true });
    writeFileSync(
      distPath,
      [
        "var GEMINI_CLIENT_ID = 'export-client-id';",
        "var GEMINI_CLIENT_SECRET = 'export-client-secret';",
      ].join("\n"),
      "utf8",
    );
    moduleMocks.resolveImpl.mockImplementation((specifier) => {
      if (specifier === "opencode-gemini-auth") {
        return distPath;
      }
      if (specifier.startsWith("opencode-gemini-auth/")) {
        throw packagePathNotExported();
      }
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-gemini-cli-companion.js");

    await expect(mod.resolveGeminiCliClientCredentials()).resolves.toMatchObject({
      state: "configured",
      clientId: "export-client-id",
      clientSecret: "export-client-secret",
      resolvedPath: distPath,
    });
  });

  it("reports invalid when package export blocks prove the package exists but no fallback resolves", async () => {
    moduleMocks.resolveImpl.mockImplementation((specifier) => {
      if (specifier.startsWith("opencode-gemini-auth/")) {
        throw packagePathNotExported();
      }
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-gemini-cli-companion.js");

    await expect(mod.inspectGeminiCliCompanionPresence()).resolves.toMatchObject({
      state: "invalid",
    });
    await expect(mod.resolveGeminiCliClientCredentials()).resolves.toMatchObject({
      state: "invalid",
    });
  });

  it("reads credentials from a v1.4.15 root-only bundle in OpenCode runtime cache node_modules", async () => {
    const runtimeCacheDir = join(tempDir, "cache", "opencode");
    const packageRoot = join(runtimeCacheDir, "node_modules", "opencode-gemini-auth");
    const distPath = join(packageRoot, "dist", "index.js");
    mkdirSync(join(packageRoot, "dist"), { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "opencode-gemini-auth",
        exports: { ".": "./dist/index.js" },
        files: ["dist", "README.md", "LICENSE"],
      }),
      "utf8",
    );
    writeFileSync(
      distPath,
      [
        "var GEMINI_CLIENT_ID = 'runtime-root-client-id';",
        "var GEMINI_CLIENT_SECRET = 'runtime-root-client-secret';",
        "export { GeminiCLIOAuthPlugin };",
      ].join("\n"),
      "utf8",
    );
    moduleMocks.runtimeDirs.value = { cacheDirs: [runtimeCacheDir] };
    moduleMocks.resolveImpl.mockImplementation((specifier, options) => {
      if (specifier === "opencode-gemini-auth" && options?.paths?.includes(runtimeCacheDir)) {
        return distPath;
      }
      if (specifier.startsWith("opencode-gemini-auth/")) {
        throw packagePathNotExported();
      }
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-gemini-cli-companion.js");

    await expect(mod.inspectGeminiCliCompanionPresence()).resolves.toMatchObject({
      state: "present",
      resolvedPath: distPath,
    });
    await expect(mod.resolveGeminiCliClientCredentials()).resolves.toMatchObject({
      state: "configured",
      clientId: "runtime-root-client-id",
      clientSecret: "runtime-root-client-secret",
      resolvedPath: distPath,
    });
    expect(moduleMocks.resolveImpl).toHaveBeenCalledWith(
      "opencode-gemini-auth/dist/src/constants.js",
      {
        paths: [runtimeCacheDir],
      },
    );
  });

  it("falls back to root package resolution with OpenCode runtime cache paths", async () => {
    const runtimeCacheDir = join(tempDir, "cache", "opencode");
    const packageRoot = join(tempDir, "resolved-package", "opencode-gemini-auth");
    const distPath = join(packageRoot, "dist", "index.js");
    mkdirSync(join(packageRoot, "dist"), { recursive: true });
    writeFileSync(
      distPath,
      [
        "var GEMINI_CLIENT_ID = 'resolved-root-client-id';",
        "var GEMINI_CLIENT_SECRET = 'resolved-root-client-secret';",
      ].join("\n"),
      "utf8",
    );
    moduleMocks.runtimeDirs.value = { cacheDirs: [runtimeCacheDir] };
    moduleMocks.resolveImpl.mockImplementation((specifier, options) => {
      if (specifier === "opencode-gemini-auth" && options?.paths?.includes(runtimeCacheDir)) {
        return distPath;
      }
      if (specifier.startsWith("opencode-gemini-auth/")) {
        throw packagePathNotExported();
      }
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-gemini-cli-companion.js");

    await expect(mod.resolveGeminiCliClientCredentials()).resolves.toMatchObject({
      state: "configured",
      clientId: "resolved-root-client-id",
      clientSecret: "resolved-root-client-secret",
      resolvedPath: distPath,
    });
    expect(moduleMocks.resolveImpl).toHaveBeenCalledWith("opencode-gemini-auth", {
      paths: [runtimeCacheDir],
    });
  });

  it("reports invalid when an installed root-only bundle lacks credentials", async () => {
    const runtimeCacheDir = join(tempDir, "cache", "opencode");
    const packageRoot = join(runtimeCacheDir, "node_modules", "opencode-gemini-auth");
    const distPath = join(packageRoot, "dist", "index.js");
    mkdirSync(join(packageRoot, "dist"), { recursive: true });
    writeFileSync(distPath, "export { GeminiCLIOAuthPlugin };\n", "utf8");
    moduleMocks.runtimeDirs.value = { cacheDirs: [runtimeCacheDir] };
    moduleMocks.resolveImpl.mockImplementation((specifier, options) => {
      if (specifier === "opencode-gemini-auth" && options?.paths?.includes(runtimeCacheDir)) {
        return distPath;
      }
      if (specifier.startsWith("opencode-gemini-auth/")) {
        throw packagePathNotExported();
      }
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-gemini-cli-companion.js");

    await expect(mod.inspectGeminiCliCompanionPresence()).resolves.toMatchObject({
      state: "invalid",
      resolvedPath: distPath,
    });
    await expect(mod.resolveGeminiCliClientCredentials()).resolves.toMatchObject({
      state: "invalid",
      resolvedPath: distPath,
    });
  });

  it("resolves source constants from OpenCode runtime cache node_modules", async () => {
    const runtimeCacheDir = join(tempDir, "cache", "opencode");
    const constantsPath = join(
      runtimeCacheDir,
      "node_modules",
      "opencode-gemini-auth",
      "src",
      "constants.ts",
    );
    mkdirSync(join(runtimeCacheDir, "node_modules", "opencode-gemini-auth", "src"), {
      recursive: true,
    });
    writeFileSync(
      constantsPath,
      [
        "export const GEMINI_CLIENT_ID = 'runtime-client-id';",
        "export const GEMINI_CLIENT_SECRET = 'runtime-client-secret';",
      ].join("\n"),
      "utf8",
    );
    moduleMocks.runtimeDirs.value = { cacheDirs: [runtimeCacheDir] };
    moduleMocks.resolveImpl.mockImplementation(() => {
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-gemini-cli-companion.js");

    await expect(mod.resolveGeminiCliClientCredentials()).resolves.toMatchObject({
      state: "configured",
      clientId: "runtime-client-id",
      clientSecret: "runtime-client-secret",
      resolvedPath: constantsPath,
    });
  });

  it("directly probes package roots under the runtime packages directory", async () => {
    const runtimeCacheDir = join(tempDir, "cache", "opencode");
    const packageRoot = join(runtimeCacheDir, "packages", "opencode-gemini-auth-1.0.0");
    const distPath = join(packageRoot, "dist", "index.js");
    mkdirSync(join(packageRoot, "dist"), { recursive: true });
    writeGeminiCredentials(distPath, { declaration: "var" });
    moduleMocks.runtimeDirs.value = { cacheDirs: [runtimeCacheDir] };
    moduleMocks.resolveImpl.mockImplementation(() => {
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-gemini-cli-companion.js");

    await expect(mod.resolveGeminiCliClientCredentials()).resolves.toMatchObject({
      state: "configured",
      clientId: "client-id",
      clientSecret: "client-secret",
      resolvedPath: distPath,
    });
  });

  it("reports invalid when the source constants file is missing usable credentials", async () => {
    const constantsPath = join(tempDir, "constants.ts");
    writeFileSync(constantsPath, "export const GEMINI_CLIENT_ID = '';\n", "utf8");
    moduleMocks.resolveImpl.mockImplementation((specifier) => {
      if (specifier === "opencode-gemini-auth/src/constants.ts") {
        return constantsPath;
      }
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-gemini-cli-companion.js");

    await expect(mod.inspectGeminiCliCompanionPresence()).resolves.toMatchObject({
      state: "invalid",
      resolvedPath: constantsPath,
    });
    await expect(mod.resolveGeminiCliClientCredentials()).resolves.toMatchObject({
      state: "invalid",
      resolvedPath: constantsPath,
    });
  });

  it("reads credentials from a nested node_modules structure in runtime packages directory", async () => {
    const runtimeCacheDir = join(tempDir, "cache", "opencode");
    const packageRoot = join(runtimeCacheDir, "packages", "opencode-gemini-auth-1.0.0");
    const nestedRoot = join(packageRoot, "node_modules", "opencode-gemini-auth");
    const distPath = join(nestedRoot, "dist", "index.js");
    mkdirSync(join(nestedRoot, "dist"), { recursive: true });
    writeGeminiCredentials(distPath, { declaration: "var" });
    moduleMocks.runtimeDirs.value = { cacheDirs: [runtimeCacheDir] };
    moduleMocks.resolveImpl.mockImplementation(() => {
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-gemini-cli-companion.js");

    await expect(mod.resolveGeminiCliClientCredentials()).resolves.toMatchObject({
      state: "configured",
      clientId: "client-id",
      clientSecret: "client-secret",
      resolvedPath: distPath,
    });
  });
});
