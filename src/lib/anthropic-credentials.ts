/**
 * Anthropic OAuth credential management.
 *
 * Ported from opencode-anthropic-login-via-cli (v1.6.1) to make status-fork
 * self-sufficient for token refresh without depending on the external plugin.
 *
 * Refresh chain:
 * 1. POST /v1/oauth/token with refresh_token (OAuth)
 * 2. Fallback: re-read ~/.claude/.credentials.json or macOS Keychain
 * 3. Fallback: run `claude --print --model claude-haiku-4 ping` to force CLI refresh
 */

import { execFile } from "child_process";
import { readFile, readdir, access as fsAccess } from "fs/promises";
import { join } from "path";
import { homedir, platform } from "os";
import { promisify } from "util";

import { getAuthPath, invalidateAuthFileCache, readAuthFileCached } from "./opencode-auth.js";
import { writeJsonAtomic } from "./atomic-json.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants (same values as the login plugin)
// ---------------------------------------------------------------------------

export const ANTHROPIC_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const ANTHROPIC_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";

/** Refresh the token this many ms before it actually expires. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

const IS_WIN = platform() === "win32";
export const CLAUDE_CMD = IS_WIN ? "claude.cmd" : "claude";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthTokens {
  access: string;
  refresh: string;
  expires: number;
}

// ---------------------------------------------------------------------------
// In-flight deduplication state
// ---------------------------------------------------------------------------

let currentRefreshToken: string | null = null;
let refreshInFlight: Promise<OAuthTokens> | null = null;

export function getCurrentRefreshToken(): string | null {
  return currentRefreshToken;
}

export function setCurrentRefreshToken(token: string | null): void {
  currentRefreshToken = token;
}

export function clearRefreshInFlight(): void {
  refreshInFlight = null;
}

export function resetRefreshState(): void {
  refreshInFlight = null;
  currentRefreshToken = null;
}

// ---------------------------------------------------------------------------
// Token refresh via OAuth endpoint
// ---------------------------------------------------------------------------

async function refreshTokens(refreshToken: string): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: ANTHROPIC_OAUTH_CLIENT_ID,
  });

  const res = await fetch(ANTHROPIC_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Token refresh failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Date.now() + data.expires_in * 1000,
  };
}

/** Deduplicated refresh: only one in-flight request per process. */
export function refreshTokensSafe(refreshToken: string): Promise<OAuthTokens> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshTokens(refreshToken).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Reading credentials from disk / Keychain
// ---------------------------------------------------------------------------

function parseCredentialJson(raw: string): OAuthTokens | null {
  try {
    const creds = JSON.parse(raw) as {
      claudeAiOauth?: { accessToken?: string; refreshToken?: string; expiresAt?: number };
    };
    const oauth = creds.claudeAiOauth;
    if (!oauth?.accessToken || !oauth.refreshToken) return null;
    return {
      access: oauth.accessToken,
      refresh: oauth.refreshToken,
      expires: oauth.expiresAt ?? 0,
    };
  } catch {
    return null;
  }
}

async function readKeychainEntry(account?: string): Promise<string | null> {
  try {
    const args = ["find-generic-password", "-s", "Claude Code-credentials"];
    if (account) args.push("-a", account);
    args.push("-w");
    const { stdout } = await execFileAsync("security", args);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function readClaudeCodeCredentials(): Promise<OAuthTokens | null> {
  try {
    let raw: string | null = null;
    if (platform() === "darwin") {
      const user = process.env["USER"] ?? "";
      if (user) raw = await readKeychainEntry(user);
      if (!raw) raw = await readKeychainEntry("Claude Code");
      if (!raw) raw = await readKeychainEntry();
    } else {
      raw = await readFile(
        join(homedir(), ".claude", ".credentials.json"),
        "utf-8",
      ).catch(() => null);
    }
    if (!raw) return null;
    return parseCredentialJson(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CCS (multiple Claude Code instances)
// ---------------------------------------------------------------------------

interface CCSInstance {
  name: string;
  credentialsPath: string;
}

export async function discoverCCSInstances(): Promise<CCSInstance[]> {
  const ccsDir = join(homedir(), ".ccs", "instances");
  try {
    const entries = await readdir(ccsDir, { withFileTypes: true });
    const instances: CCSInstance[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const credPath = join(ccsDir, entry.name, ".credentials.json");
      try {
        await fsAccess(credPath);
        instances.push({ name: entry.name, credentialsPath: credPath });
      } catch {
        // not accessible
      }
    }
    return instances;
  } catch {
    return [];
  }
}

async function readCCSCredentials(credentialsPath: string): Promise<OAuthTokens | null> {
  try {
    const raw = await readFile(credentialsPath, "utf-8");
    return parseCredentialJson(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CLI-based refresh fallback
// ---------------------------------------------------------------------------

export async function refreshViaClaudeCli(binaryPath?: string): Promise<OAuthTokens | null> {
  const cmd = binaryPath?.trim() || CLAUDE_CMD;
  try {
    await execFileAsync(cmd, ["--print", "--model", "claude-haiku-4", "ping"], {
      timeout: 30_000,
      env: { ...process.env, TERM: "dumb" },
    });
  } catch {
    // ignore — side-effect is what matters (CLI refreshes credentials file)
  }
  return readClaudeCodeCredentials();
}

// ---------------------------------------------------------------------------
// Alternate credential search (CCS + main CLI)
// ---------------------------------------------------------------------------

export async function findAlternateCredentials(
  currentRefresh: string | null,
): Promise<OAuthTokens | null> {
  const main = await readClaudeCodeCredentials();
  if (main && main.refresh !== currentRefresh && !isExpiringSoon(main.expires)) {
    return main;
  }
  const instances = await discoverCCSInstances();
  for (const inst of instances) {
    const creds = await readCCSCredentials(inst.credentialsPath);
    if (creds && creds.refresh !== currentRefresh && !isExpiringSoon(creds.expires)) {
      return creds;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Expiry helpers
// ---------------------------------------------------------------------------

export function isExpiringSoon(expiresAt: number): boolean {
  return Date.now() + REFRESH_BUFFER_MS >= expiresAt;
}

export function hasClaude(binaryPath?: string): boolean {
  return !!(binaryPath?.trim() || CLAUDE_CMD);
}

// ---------------------------------------------------------------------------
// Full refresh chain (mirrors refreshAuth from the login plugin)
// ---------------------------------------------------------------------------

export interface AnthropicAuthEntry {
  type: string;
  access?: string;
  refresh?: string;
  expires?: number;
}

/**
 * Full refresh chain — mirrors `refreshAuth` from opencode-anthropic-login-via-cli.
 *
 * Tries (in order):
 * 1. refreshTokensSafe() with the current refresh token
 * 2. readClaudeCodeCredentials() (disk / Keychain)
 * 3. refreshViaClaudeCli() (forces CLI to refresh then re-reads disk)
 *
 * On success, writes the new tokens to auth.json.
 * Returns the new tokens or null if all methods failed.
 */
export async function refreshAnthropicAuth(
  auth: AnthropicAuthEntry,
  binaryPath?: string,
): Promise<OAuthTokens | null> {
  // Always read the latest refresh token from disk in case it rotated.
  let refreshToken: string | undefined;
  try {
    invalidateAuthFileCache();
    const latest = await readAuthFileCached({ maxAgeMs: 0 });
    const entry = (latest as { anthropic?: AnthropicAuthEntry } | null)?.anthropic;
    if (entry?.type === "oauth" && entry.refresh) {
      refreshToken = entry.refresh;
    }
  } catch {
    // fall back to snapshot
  }
  refreshToken ??= auth.refresh;

  // 1. OAuth refresh_token endpoint
  if (refreshToken) {
    try {
      const fresh = await refreshTokensSafe(refreshToken);
      await writeAnthropicTokensToAuthJson(fresh);
      return fresh;
    } catch {
      // fall through
    }
  }

  // 2. Read from disk / Keychain (may be already-fresh after an out-of-band refresh)
  const kc = await readClaudeCodeCredentials();
  if (kc && !isExpiringSoon(kc.expires)) {
    await writeAnthropicTokensToAuthJson(kc);
    clearRefreshInFlight();
    setCurrentRefreshToken(kc.refresh);
    return kc;
  }

  // 3. Force CLI refresh, then re-read from disk
  const cli = await refreshViaClaudeCli(binaryPath);
  if (cli && !isExpiringSoon(cli.expires)) {
    await writeAnthropicTokensToAuthJson(cli);
    clearRefreshInFlight();
    setCurrentRefreshToken(cli.refresh);
    return cli;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Write new tokens back to auth.json
// ---------------------------------------------------------------------------

async function writeAnthropicTokensToAuthJson(tokens: OAuthTokens): Promise<void> {
  try {
    const authPath = getAuthPath();
    let existing: Record<string, unknown> = {};
    try {
      const raw = await readFile(authPath, "utf-8");
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // start with empty object
    }

    existing["anthropic"] = {
      type: "oauth",
      access: tokens.access,
      refresh: tokens.refresh,
      expires: tokens.expires,
    };

    await writeJsonAtomic(authPath, existing, { trailingNewline: true });
    invalidateAuthFileCache();
  } catch {
    // persistence failure must not break the refresh
  }
}
