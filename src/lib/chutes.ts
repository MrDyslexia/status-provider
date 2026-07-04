/**
 * Chutes AI status fetcher
 *
 * Resolves API key from multiple sources and queries:
 * https://api.chutes.ai/users/me/status_usage/me
 */

import type { ChutesResult } from "./types.js";
import { sanitizeDisplaySnippet, sanitizeDisplayText } from "./display-sanitize.js";
import { fetchWithTimeout } from "./http.js";
import { clampPercent } from "./format-utils.js";
import {
  resolveChutesApiKey,
  getChutesKeyDiagnostics,
  hasChutesApiKey,
  type ChutesKeySource,
} from "./chutes-config.js";

interface ChutesStatusResponse {
  status: number;
  used: number;
}

function getNextDailyResetUtc(): string {
  const now = new Date();
  const reset = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  );
  return reset.toISOString();
}

const CHUTES_STATUS_URL = "https://api.chutes.ai/users/me/status_usage/me";

export {
  getChutesKeyDiagnostics,
  hasChutesApiKey as hasChutesApiKeyConfigured,
  type ChutesKeySource,
} from "./chutes-config.js";

export async function queryChutesStatus(options: { requestTimeoutMs?: number } = {}): Promise<ChutesResult> {
  const resolved = await resolveChutesApiKey();
  if (!resolved) return null;

  try {
    const resp = await fetchWithTimeout(
      CHUTES_STATUS_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${resolved.key}`,
          "User-Agent": "OpenCode-Status-Toast/1.0",
        },
      },
      options.requestTimeoutMs,
    );

    if (!resp.ok) {
      const text = await resp.text();
      return {
        success: false,
        error: `Chutes API error ${resp.status}: ${sanitizeDisplaySnippet(text, 120)}`,
      };
    }

    const data = (await resp.json()) as ChutesStatusResponse;

    // Chutes returns used and status.
    const used = typeof data.used === "number" ? data.used : 0;
    const status = typeof data.status === "number" ? data.status : 0;

    const percentRemaining = status > 0 ? clampPercent(((status - used) / status) * 100) : 0;

    return {
      success: true,
      percentRemaining,
      resetTimeIso: getNextDailyResetUtc(),
    };
  } catch (err) {
    return {
      success: false,
      error: sanitizeDisplayText(err instanceof Error ? err.message : String(err)),
    };
  }
}
