/**
 * Claude CLI binary introspection.
 *
 * Ported from opencode-anthropic-login-via-cli (v1.6.1).
 * Reads betaHeaders, OAuth scopes, and version info directly from the
 * Claude CLI binary so status-fork stays in sync with Anthropic's API
 * automatically instead of relying on hardcoded values.
 */

import { execFile } from "child_process";
import { access as fsAccess, createReadStream } from "fs";
import { join } from "path";
import { homedir, platform } from "os";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_VERSION = "2.1.84";
export const DEFAULT_SCOPES =
  "org:create_api_key user:file_upload user:inference user:mcp_servers user:profile user:sessions:claude_code";
export const CLAUDE_CODE_ENTRYPOINT = "sdk-cli";

const IS_WIN = platform() === "win32";
const CLAUDE_CMD = IS_WIN ? "claude.cmd" : "claude";

export const BASE_BETAS = [
  "claude-code-20250219",
  "interleaved-thinking-2025-05-14",
  "oauth-2025-04-20",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
];

const LONG_CONTEXT_BETAS = ["context-1m-2025-08-07"];

const MODEL_OVERRIDES: Record<string, { add?: string[]; remove?: string[] }> = {
  "4-6": { add: ["effort-2025-11-24"] },
};

const KNOWN_BETA_PREFIXES = [
  "claude-code-",
  "interleaved-thinking-",
  "context-management-",
  "oauth-",
  "prompt-caching-scope-",
  "context-1m-",
  "effort-",
];

// ---------------------------------------------------------------------------
// Introspection result
// ---------------------------------------------------------------------------

export interface IntrospectionResult {
  version: string;
  userAgent: string;
  betaHeaders: string[];
  scopes: string;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _intro: IntrospectionResult = {
  version: DEFAULT_VERSION,
  userAgent: getUserAgent(DEFAULT_VERSION),
  betaHeaders: BASE_BETAS,
  scopes: DEFAULT_SCOPES,
};
let _introPromise: Promise<void> | null = null;

export function getIntro(): IntrospectionResult {
  return _intro;
}

export async function awaitIntro(): Promise<IntrospectionResult> {
  if (_introPromise) await _introPromise;
  return _intro;
}

export function startIntro(binaryPath?: string): void {
  _introPromise = introspectClaudeBinary(binaryPath)
    .then((result) => {
      if (result) _intro = result;
    })
    .catch(() => {
      // keep defaults
    })
    .finally(() => {
      _introPromise = null;
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getUserAgent(version: string): string {
  if (process.env["ANTHROPIC_USER_AGENT"]) return process.env["ANTHROPIC_USER_AGENT"];
  return `claude-cli/${version} (external, cli)`;
}

function getCliVersion(fallback: string): string {
  return process.env["ANTHROPIC_CLI_VERSION"] ?? fallback;
}

function parseCliVersion(output: string): string {
  const match = output.match(/\b(\d+\.\d+\.\d+(?:[-+][^\s]+)?)\b/);
  return match?.[1] ?? DEFAULT_VERSION;
}

export function getBetaFlags(baseBetas: string[]): string[] {
  const env = process.env["ANTHROPIC_BETA_FLAGS"];
  if (env) {
    return env
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean);
  }
  return baseBetas;
}

export function getBetasForModel(
  modelId: string,
  baseBetas: string[],
  options?: { enableLongContext?: boolean },
): string[] {
  let betas = [...baseBetas];
  const longCtx =
    options?.enableLongContext ||
    process.env["ANTHROPIC_ENABLE_1M_CONTEXT"] === "1" ||
    process.env["ANTHROPIC_ENABLE_1M_CONTEXT"] === "true";

  if (longCtx) {
    for (const b of LONG_CONTEXT_BETAS) {
      if (!betas.includes(b)) betas.push(b);
    }
  }

  for (const [pattern, overrides] of Object.entries(MODEL_OVERRIDES)) {
    if (modelId.includes(pattern)) {
      if (overrides.add) {
        for (const b of overrides.add) {
          if (!betas.includes(b)) betas.push(b);
        }
      }
      if (overrides.remove) {
        betas = betas.filter((b) => !overrides.remove!.includes(b));
      }
    }
  }
  return betas;
}

// ---------------------------------------------------------------------------
// Binary discovery
// ---------------------------------------------------------------------------

async function findClaudeBinary(providedPath?: string): Promise<string | null> {
  if (providedPath?.trim()) {
    try {
      await new Promise<void>((resolve, reject) =>
        fsAccess(providedPath, (err) => (err ? reject(err) : resolve())),
      );
      return providedPath.trim();
    } catch {
      // fall through
    }
  }

  if (IS_WIN) {
    const candidates = [
      join(homedir(), ".claude", "local", "claude.exe"),
      join(homedir(), "AppData", "Local", "Programs", "claude-code", "claude.exe"),
    ];
    for (const p of candidates) {
      try {
        await new Promise<void>((resolve, reject) =>
          fsAccess(p, (err) => (err ? reject(err) : resolve())),
        );
        return p;
      } catch {
        // try next
      }
    }
    try {
      const { stdout } = await execFileAsync("where", ["claude"], { timeout: 3000 });
      const first = stdout.trim().split(/\r?\n/)[0];
      if (first) return first.trim();
    } catch {
      // not found
    }
    return null;
  }

  try {
    const { stdout } = await execFileAsync("which", ["claude"], { timeout: 3000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Binary scanning (Windows)
// ---------------------------------------------------------------------------

const SCAN_CHUNK_SIZE = 256 * 1024;
const SCAN_OVERLAP = 128;

async function streamScanBinary(
  binaryPath: string,
  patterns: RegExp[],
): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const results = patterns.map(() => new Set<string>());
    let tail = "";
    const stream = createReadStream(binaryPath, { highWaterMark: SCAN_CHUNK_SIZE });
    stream.on("data", (chunk: Buffer | string) => {
      const raw = typeof chunk === "string" ? chunk : chunk.toString("latin1");
      const text = tail + raw;
      for (let i = 0; i < patterns.length; i++) {
        const flags = patterns[i]!.flags.includes("g")
          ? patterns[i]!.flags
          : `${patterns[i]!.flags}g`;
        const re = new RegExp(patterns[i]!.source, flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          results[i]!.add(m[0]);
        }
      }
      tail = text.length > SCAN_OVERLAP ? text.slice(-SCAN_OVERLAP) : text;
    });
    stream.on("end", () => resolve(results.map((s) => [...s])));
    stream.on("error", reject);
  });
}

const BETA_RE =
  /(?<![a-z0-9-])(?:claude-code-\d{8}|[a-z0-9]+(?:-[a-z0-9]+)*-20\d{2}-\d{2}-\d{2})(?![a-z0-9-])/g;
const SCOPE_RE = /(?:user|org):[a-z][a-z0-9_]+(?::[a-z][a-z0-9_]+)*/g;

async function extractFromBinaryWin(
  binaryPath: string,
): Promise<{ betaHeaders: string[] | null; scopes: string | null }> {
  const [betaMatches, scopeMatches] = await streamScanBinary(binaryPath, [BETA_RE, SCOPE_RE]);
  const betaHeaders = (betaMatches ?? []).filter((h) =>
    KNOWN_BETA_PREFIXES.some((p) => h.startsWith(p)),
  );
  if (!betaHeaders.some((h) => h.startsWith("oauth-"))) {
    betaHeaders.push("oauth-2025-04-20");
  }
  const scopes = (scopeMatches ?? []).filter(
    (s) =>
      !s.includes("this") &&
      !s.endsWith(":") &&
      (s.startsWith("user:") || s.startsWith("org:")),
  );
  return {
    betaHeaders: betaHeaders.length > 0 ? betaHeaders : null,
    scopes: scopes.length > 0 ? scopes.join(" ") : null,
  };
}

async function extractBetaHeadersUnix(binaryPath: string): Promise<string[] | null> {
  try {
    const shellSafe = binaryPath.replace(/'/g, "'\\''");
    const { stdout } = await execFileAsync(
      "sh",
      [
        "-c",
        `strings '${shellSafe}' | grep -oE '[a-z0-9]+(-[a-z0-9]+)*-20[0-9]{2}-[0-9]{2}-[0-9]{2}|claude-code-[0-9]+' | sort -u`,
      ],
      { timeout: 30_000 },
    );
    const headers = stdout
      .trim()
      .split("\n")
      .filter((h) => h && KNOWN_BETA_PREFIXES.some((p) => h.startsWith(p)));
    if (!headers.some((h) => h.startsWith("oauth-"))) {
      headers.push("oauth-2025-04-20");
    }
    return headers.length > 0 ? headers : null;
  } catch {
    return null;
  }
}

async function extractScopesUnix(binaryPath: string): Promise<string | null> {
  try {
    const shellSafe = binaryPath.replace(/'/g, "'\\''");
    const { stdout } = await execFileAsync(
      "sh",
      [
        "-c",
        `strings '${shellSafe}' | grep -oE '(user|org):[a-z][a-z0-9_]+(:[a-z][a-z0-9_]+)*' | sort -u`,
      ],
      { timeout: 30_000 },
    );
    const scopes = stdout
      .trim()
      .split("\n")
      .filter(
        (s) =>
          s && !s.includes("this") && !s.endsWith(":") && (s.startsWith("user:") || s.startsWith("org:")),
      );
    return scopes.length > 0 ? scopes.join(" ") : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main introspection
// ---------------------------------------------------------------------------

async function introspectClaudeBinary(
  providedPath?: string,
): Promise<IntrospectionResult | null> {
  try {
    const cmd = providedPath?.trim() || CLAUDE_CMD;
    const { stdout: versionOut } = await execFileAsync(cmd, ["--version"], { timeout: 5000 });
    const rawVersion = parseCliVersion(versionOut);
    const version = getCliVersion(rawVersion);

    const binaryPath = await findClaudeBinary(providedPath);
    if (!binaryPath) {
      return {
        version,
        userAgent: getUserAgent(version),
        betaHeaders: BASE_BETAS,
        scopes: DEFAULT_SCOPES,
      };
    }

    let betaHeaders: string[] | null;
    let scopes: string | null;

    if (IS_WIN) {
      const extracted = await extractFromBinaryWin(binaryPath);
      betaHeaders = extracted.betaHeaders;
      scopes = extracted.scopes;
    } else {
      [betaHeaders, scopes] = await Promise.all([
        extractBetaHeadersUnix(binaryPath),
        extractScopesUnix(binaryPath),
      ]);
    }

    const longCtxPrefixes = LONG_CONTEXT_BETAS.map((b) => b.replace(/-\d{4}-\d{2}-\d{2}$/, "-"));
    const filteredBetas = (betaHeaders ?? BASE_BETAS).filter(
      (h) => !longCtxPrefixes.some((p) => h.startsWith(p)),
    );

    return {
      version,
      userAgent: getUserAgent(version),
      betaHeaders: filteredBetas.length > 0 ? filteredBetas : BASE_BETAS,
      scopes: scopes ?? DEFAULT_SCOPES,
    };
  } catch {
    return null;
  }
}
