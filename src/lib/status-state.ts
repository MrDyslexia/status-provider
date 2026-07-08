import { createHash } from "crypto";
import { readFile, readdir, rm, stat } from "fs/promises";
import { join } from "path";

import type { StatusProvider, StatusProviderContext, StatusProviderResult } from "./entries.js";

import { writeJsonAtomic } from "./atomic-json.js";
import { getOpencodeRuntimeDirs } from "./opencode-runtime-paths.js";
import { isLiveLocalUsageProviderId } from "./provider-metadata.js";
import { getPackageVersion } from "./version.js";

const STATUS_PROVIDER_CACHE_VERSION = 2 as const;
const STATUS_PROVIDER_CACHE_PACKAGE_VERSION_FALLBACK = "unknown";
const STATUS_PROVIDER_CACHE_DIRNAME = "status-provider-state";
const STATUS_PROVIDER_CACHE_RETENTION_MS = 24 * 60 * 60 * 1000;
const STATUS_PROVIDER_CACHE_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
/**
 * Grace period during which a stale (TTL-expired) cache entry is still usable
 * for the stale-data fallback when a provider returns 429 with no fresh
 * entries. Covers CLI restart / cache invalidation windows.
 */
const STATUS_PROVIDER_STALE_TTL_MS = 24 * 60 * 60 * 1000;

export type PersistedStatusProviderCacheEntry = {
  version: typeof STATUS_PROVIDER_CACHE_VERSION;
  packageVersion: string;
  key: string;
  providerId: string;
  timestamp: number;
  result: StatusProviderResult;
  /** Last useful snapshot with entries, preserved across later 429/error states. */
  lastSuccessfulResult?: StatusProviderResult;
  /** Optional rate-limited-until timestamp propagated from the provider result. */
  rateLimitedUntil?: number;
};

const inMemoryCache = new Map<string, PersistedStatusProviderCacheEntry>();
const inFlightByKey = new Map<string, Promise<StatusProviderResult>>();
let lastPruneAtMs = 0;

export function cloneStatusProviderResult(result: StatusProviderResult): StatusProviderResult {
  return {
    attempted: result.attempted,
    entries: result.entries.map((entry) => ({ ...entry })),
    errors: result.errors.map((error) => ({ ...error })),
    ...(result.presentation ? { presentation: { ...result.presentation } } : {}),
    ...(typeof result.rateLimitedUntil === "number"
      ? { rateLimitedUntil: result.rateLimitedUntil }
      : {}),
  };
}

function buildReusableSuccessResult(result: StatusProviderResult): StatusProviderResult | null {
  if (!Array.isArray(result.entries) || result.entries.length === 0) {
    return null;
  }

  return {
    attempted: true,
    entries: result.entries.map((entry) => ({ ...entry })),
    errors: [],
    ...(result.presentation ? { presentation: { ...result.presentation } } : {}),
  };
}

export function buildStatusProviderStateCacheKey(
  providerId: string,
  ctx: StatusProviderContext,
): string {
  const googleModels = ctx.config.googleModels.join(",");
  const alibabaCodingPlanTier = ctx.config.alibabaCodingPlanTier;
  const cursorPlan = ctx.config.cursorPlan;
  const cursorIncludedApiUsd = ctx.config.cursorIncludedApiUsd ?? "";
  const cursorBillingCycleStartDay = ctx.config.cursorBillingCycleStartDay ?? "";
  const opencodeGoWindows = ctx.config.opencodeGoWindows?.join(",") ?? "";
  const onlyCurrentModel = ctx.config.onlyCurrentModel ? "yes" : "no";
  const currentModel = ctx.config.currentModel ?? "";
  const currentProviderID = ctx.config.currentProviderID ?? "";
  const anthropicBinaryPath = ctx.config.anthropicBinaryPath ?? "";

  return `${providerId}|anthropicBinaryPath=${anthropicBinaryPath}|googleModels=${googleModels}|alibabaTier=${alibabaCodingPlanTier}|cursorPlan=${cursorPlan}|cursorIncludedApiUsd=${cursorIncludedApiUsd}|cursorBillingCycleStartDay=${cursorBillingCycleStartDay}|opencodeGoWindows=${opencodeGoWindows}|onlyCurrentModel=${onlyCurrentModel}|currentModel=${currentModel}|currentProviderID=${currentProviderID}`;
}

function getStatusProviderCacheDir(): string {
  return join(getOpencodeRuntimeDirs().cacheDir, STATUS_PROVIDER_CACHE_DIRNAME);
}

export function getStatusProviderStateCacheFilePath(providerId: string, key: string): string {
  const digest = createHash("sha1").update(key).digest("hex");
  return join(getStatusProviderCacheDir(), `${providerId}-${digest}.json`);
}

function isStatusProviderPresentation(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const presentation = value as Record<string, unknown>;
  const hasKnownField =
    "singleWindowDisplayName" in presentation ||
    "singleWindowShowRight" in presentation ||
    "classicDisplayName" in presentation ||
    "classicShowRight" in presentation ||
    "classicStrategy" in presentation;

  if (!hasKnownField) {
    return false;
  }

  return (
    (presentation.singleWindowDisplayName === undefined ||
      typeof presentation.singleWindowDisplayName === "string") &&
    (presentation.singleWindowShowRight === undefined ||
      typeof presentation.singleWindowShowRight === "boolean") &&
    (presentation.classicDisplayName === undefined ||
      typeof presentation.classicDisplayName === "string") &&
    (presentation.classicShowRight === undefined ||
      typeof presentation.classicShowRight === "boolean") &&
    (presentation.classicStrategy === undefined ||
      presentation.classicStrategy === "preserve" ||
      presentation.classicStrategy === "collapse_worst" ||
      presentation.classicStrategy === "first")
  );
}

function isStatusProviderResult(value: unknown): value is StatusProviderResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Record<string, unknown>;
  if (typeof result.attempted !== "boolean") {
    return false;
  }

  if (!Array.isArray(result.entries) || !Array.isArray(result.errors)) {
    return false;
  }

  if (result.presentation !== undefined && !isStatusProviderPresentation(result.presentation)) {
    return false;
  }

  if (result.rateLimitedUntil !== undefined && typeof result.rateLimitedUntil !== "number") {
    return false;
  }

  return true;
}

async function getStatusProviderCachePackageVersion(): Promise<string> {
  return (await getPackageVersion()) ?? STATUS_PROVIDER_CACHE_PACKAGE_VERSION_FALLBACK;
}

function isPersistedStatusProviderCacheEntry(
  value: unknown,
  key: string,
  providerId: string,
  packageVersion: string,
): value is PersistedStatusProviderCacheEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Record<string, unknown>;
    return (
      entry.version === STATUS_PROVIDER_CACHE_VERSION &&
      entry.packageVersion === packageVersion &&
      entry.key === key &&
      entry.providerId === providerId &&
      typeof entry.timestamp === "number" &&
      isStatusProviderResult(entry.result) &&
      (entry.lastSuccessfulResult === undefined || isStatusProviderResult(entry.lastSuccessfulResult)) &&
      (entry.rateLimitedUntil === undefined || typeof entry.rateLimitedUntil === "number")
    );
}

async function safeRm(path: string): Promise<void> {
  try {
    await rm(path, { force: true, recursive: true });
  } catch {
    // best-effort cleanup
  }
}

async function maybePrunePersistedStatusProviderCache(now: number): Promise<void> {
  if (now - lastPruneAtMs < STATUS_PROVIDER_CACHE_PRUNE_INTERVAL_MS) {
    return;
  }

  lastPruneAtMs = now;
  const cacheDir = getStatusProviderCacheDir();

  try {
    const entries = await readdir(cacheDir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile()) {
          return;
        }

        const path = join(cacheDir, entry.name);
        try {
          const info = await stat(path);
          if (now - info.mtimeMs > STATUS_PROVIDER_CACHE_RETENTION_MS) {
            await safeRm(path);
          }
        } catch {
          // ignore unreadable files during best-effort pruning
        }
      }),
    );
  } catch {
    // missing/unreadable cache dir is non-fatal
  }
}

async function readPersistedStatusProviderCacheEntry(params: {
  key: string;
  providerId: string;
  packageVersion: string;
  ttlMs: number;
  now: number;
}): Promise<PersistedStatusProviderCacheEntry | null> {
  if (params.ttlMs <= 0) {
    return null;
  }

  const path = getStatusProviderStateCacheFilePath(params.providerId, params.key);

  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isPersistedStatusProviderCacheEntry(
        parsed,
        params.key,
        params.providerId,
        params.packageVersion,
      )
    ) {
      await safeRm(path);
      return null;
    }

    if (params.now - parsed.timestamp >= params.ttlMs) {
      return null;
    }

    return {
      version: parsed.version,
      packageVersion: parsed.packageVersion,
      key: parsed.key,
      providerId: parsed.providerId,
      timestamp: parsed.timestamp,
      lastSuccessfulResult: parsed.lastSuccessfulResult
        ? cloneStatusProviderResult(parsed.lastSuccessfulResult)
        : undefined,
      rateLimitedUntil: parsed.rateLimitedUntil,
      result: cloneStatusProviderResult(parsed.result),
    };
  } catch {
    return null;
  }
}

async function writePersistedStatusProviderCacheEntry(
  entry: PersistedStatusProviderCacheEntry,
): Promise<void> {
  try {
    await writeJsonAtomic(getStatusProviderStateCacheFilePath(entry.providerId, entry.key), entry, {
      trailingNewline: true,
    });
  } catch {
    // persistence failures should not break status fetches
  }
}

/** Return the rate-limited-until timestamp for a cache entry, or null. */
function getEntryRateLimitedUntil(entry: PersistedStatusProviderCacheEntry | null | undefined): number | null {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.rateLimitedUntil === "number") return entry.rateLimitedUntil;
  if (entry.result && typeof entry.result.rateLimitedUntil === "number") {
    return entry.result.rateLimitedUntil;
  }
  return null;
}

/** True if the entry is still within a rate-limited window at `now`. */
function isEntryRateLimited(
  entry: PersistedStatusProviderCacheEntry | null | undefined,
  now: number,
): boolean {
  const until = getEntryRateLimitedUntil(entry);
  return typeof until === "number" && until > now;
}

export async function fetchStatusProviderResult(params: {
  provider: StatusProvider;
  ctx: StatusProviderContext;
  ttlMs: number;
  bypassCache?: boolean;
}): Promise<StatusProviderResult> {
  const { provider, ctx, ttlMs, bypassCache = false } = params;

  if (bypassCache || isLiveLocalUsageProviderId(provider.id)) {
    return cloneStatusProviderResult(await provider.fetch(ctx));
  }

  const key = buildStatusProviderStateCacheKey(provider.id, ctx);
  const now = Date.now();
  const packageVersion = await getStatusProviderCachePackageVersion();
  await maybePrunePersistedStatusProviderCache(now);

  // 1. In-memory cache: serve if still within TTL OR still rate-limited.
  //    Rate-limited entries are always served because the provider is
  //    expected to return no fresh data anyway, and we want to keep the
  //    rate-limited lock observable.
  const inMemory = inMemoryCache.get(key);
  if (
    inMemory &&
    inMemory.packageVersion === packageVersion &&
    ttlMs > 0 &&
    (isEntryRateLimited(inMemory, now) || now - inMemory.timestamp < ttlMs)
  ) {
    return cloneStatusProviderResult(inMemory.result);
  }

  // 2. De-dupe in-flight requests for the same key.
  const inFlight = inFlightByKey.get(key);
  if (inFlight) {
    return cloneStatusProviderResult(await inFlight);
  }

  // 3. Persisted cache: serve only if not rate-limited AND still within TTL.
  //    A persisted rate-limited entry does NOT count as fresh — we still want
  //    to attempt a fetch (which will return the rate-limited state again,
  //    or maybe succeed if the lock has expired).
  const persisted = await readPersistedStatusProviderCacheEntry({
    key,
    providerId: provider.id,
    packageVersion,
    ttlMs,
    now,
  });
  if (
    persisted &&
    !isEntryRateLimited(persisted, now) &&
    now - persisted.timestamp < ttlMs
  ) {
    inMemoryCache.set(key, {
      ...persisted,
      result: cloneStatusProviderResult(persisted.result),
    });
    return cloneStatusProviderResult(persisted.result);
  }

  // 4. Fetch: capture previous entries first for the stale-data fallback.
  const previousInMemory = inMemory;
  let previousEntries: StatusProviderResult["entries"] = previousInMemory?.result.entries ?? [];
  let previousSuccessfulResult = previousInMemory?.lastSuccessfulResult
    ? cloneStatusProviderResult(previousInMemory.lastSuccessfulResult)
    : null;

  if (!previousSuccessfulResult && previousInMemory?.result.entries.length) {
    previousSuccessfulResult = buildReusableSuccessResult(previousInMemory.result);
  }

  // If the in-memory cache had no entries, also check the persisted cache
  // with an extended grace period (covers in-memory loss across processes).
  if (previousEntries.length === 0) {
    try {
      const previousPersisted = await readPersistedStatusProviderCacheEntry({
        key,
        providerId: provider.id,
        packageVersion,
        ttlMs: STATUS_PROVIDER_STALE_TTL_MS,
        now,
      });
      if (previousPersisted?.result.entries.length) {
        previousEntries = previousPersisted.result.entries;
      }
      if (!previousSuccessfulResult && previousPersisted?.lastSuccessfulResult) {
        previousSuccessfulResult = cloneStatusProviderResult(previousPersisted.lastSuccessfulResult);
      }
      if (!previousSuccessfulResult && previousPersisted?.result.entries.length) {
        previousSuccessfulResult = buildReusableSuccessResult(previousPersisted.result);
      }
    } catch {
      // best-effort
    }
  }

  const fetchPromise = (async () => {
    const fetched = await provider.fetch(ctx);
    const snapshot = cloneStatusProviderResult(fetched);

    if (!snapshot.attempted) {
      inMemoryCache.delete(key);
      await safeRm(getStatusProviderStateCacheFilePath(provider.id, key));
      return snapshot;
    }

    // Stale-data fallback: if the provider returned a rate-limited result
    // with no fresh entries, and we have previous entries, surface them
    // along with the rateLimitedUntil marker so the caller can render a
    // "rate limited" indicator next to the last-known-good data.
    const rateLimitedUntil =
      typeof snapshot.rateLimitedUntil === "number" ? snapshot.rateLimitedUntil : null;
    const shouldUseStaleEntries =
      rateLimitedUntil !== null && snapshot.entries.length === 0 && previousEntries.length > 0;
    const resultToCache = shouldUseStaleEntries
      ? { ...snapshot, entries: previousEntries.map((entry) => ({ ...entry })) }
      : snapshot;
    const currentSuccessfulResult = buildReusableSuccessResult(snapshot);
    const lastSuccessfulResult = currentSuccessfulResult ?? previousSuccessfulResult ?? undefined;

    const entry: PersistedStatusProviderCacheEntry = {
      version: STATUS_PROVIDER_CACHE_VERSION,
      packageVersion,
      key,
      providerId: provider.id,
      timestamp: Date.now(),
      lastSuccessfulResult,
      rateLimitedUntil: rateLimitedUntil ?? undefined,
      result: cloneStatusProviderResult(resultToCache),
    };

    inMemoryCache.set(key, {
      ...entry,
      result: cloneStatusProviderResult(entry.result),
    });
    await writePersistedStatusProviderCacheEntry(entry);
    return shouldUseStaleEntries ? resultToCache : snapshot;
  })().finally(() => {
    inFlightByKey.delete(key);
  });

  inFlightByKey.set(key, fetchPromise);
  return cloneStatusProviderResult(await fetchPromise);
}

export function __resetStatusStateForTests(): void {
  inMemoryCache.clear();
  inFlightByKey.clear();
  lastPruneAtMs = 0;
}
