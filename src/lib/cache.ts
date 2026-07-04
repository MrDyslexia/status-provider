/**
 * Keyed cache and throttling system for rendered status toasts.
 *
 * This is presentation-only throttling:
 * - Each cache key stores the last rendered toast string for that surface/session context
 * - Only fetch if minIntervalMs has passed since the last fetch for that key
 * - Deduplicate concurrent fetches per key
 */

import type { CachedToast } from "./types.js";

type CacheEntry = {
  cachedToast: CachedToast | null;
  inFlightPromise: Promise<string | null> | null;
  lastFetchTime: number;
  lastAccessTime: number;
};

// Bounded LRU eviction: keeps the cache map from growing unbounded when many
// distinct keys (per session × config variant) get created over the process
// lifetime. When the map exceeds `MAX_ENTRIES`, oldest-by-access entries are
// dropped until we are under the cap.
const MAX_CACHE_ENTRIES = 128;

const cacheEntries = new Map<string, CacheEntry>();

function touchEntry(cacheKey: string, entry: CacheEntry): void {
  entry.lastAccessTime = Date.now();
}

function evictIfNeeded(): void {
  if (cacheEntries.size <= MAX_CACHE_ENTRIES) return;

  // Drop at most 25% of the oldest-by-access entries in one pass so the cache
  // stays well below the cap without churning on every insert.
  const targetDrop = Math.ceil(cacheEntries.size - MAX_CACHE_ENTRIES * 0.75);
  const sorted = [...cacheEntries.entries()].sort(
    (a, b) => a[1].lastAccessTime - b[1].lastAccessTime,
  );

  // Never evict an entry that has an in-flight fetch — that would orphan the
  // pending promise and leak memory.
  let dropped = 0;
  for (const [key, entry] of sorted) {
    if (dropped >= targetDrop) break;
    if (entry.inFlightPromise) continue;
    if (entry.cachedToast) continue;
    cacheEntries.delete(key);
    dropped += 1;
  }
}

function getCacheEntry(cacheKey: string): CacheEntry {
  const existing = cacheEntries.get(cacheKey);
  if (existing) {
    touchEntry(cacheKey, existing);
    return existing;
  }

  const created: CacheEntry = {
    cachedToast: null,
    inFlightPromise: null,
    lastFetchTime: 0,
    lastAccessTime: Date.now(),
  };
  cacheEntries.set(cacheKey, created);
  evictIfNeeded();
  return created;
}

/**
 * Get the cached toast message for a key if still valid.
 */
export function getCachedToast(cacheKey: string, minIntervalMs: number): string | null {
  const cacheEntry = cacheEntries.get(cacheKey);
  if (!cacheEntry?.cachedToast) {
    return null;
  }

  touchEntry(cacheKey, cacheEntry);
  const now = Date.now();
  const age = now - cacheEntry.cachedToast.timestamp;

  if (age < minIntervalMs) {
    return cacheEntry.cachedToast.message;
  }

  return null;
}

/**
 * Check if a new fetch should be initiated for a key.
 */
export function shouldFetch(cacheKey: string, minIntervalMs: number): boolean {
  const cacheEntry = getCacheEntry(cacheKey);
  const now = Date.now();
  return now - cacheEntry.lastFetchTime >= minIntervalMs;
}

/**
 * Get or start a fetch operation with keyed deduplication.
 */
export async function getOrFetch(
  cacheKey: string,
  fetchFn: () => Promise<string | null>,
  minIntervalMs: number,
): Promise<string | null> {
  const wrapped = async () => {
    const message = await fetchFn();
    return { message, cache: true };
  };
  return getOrFetchWithCacheControl(cacheKey, wrapped, minIntervalMs);
}

/**
 * Get or start a fetch operation with keyed deduplication and cache control.
 *
 * This is useful when some results should be displayed but not cached
 * (e.g. transient "all providers failed" cases).
 */
export async function getOrFetchWithCacheControl(
  cacheKey: string,
  fetchFn: () => Promise<{ message: string | null; cache?: boolean }>,
  minIntervalMs: number,
): Promise<string | null> {
  const cacheEntry = getCacheEntry(cacheKey);

  const cached = getCachedToast(cacheKey, minIntervalMs);
  if (cached !== null) {
    return cached;
  }

  if (cacheEntry.inFlightPromise) {
    return cacheEntry.inFlightPromise;
  }

  if (!shouldFetch(cacheKey, minIntervalMs)) {
    return cacheEntry.cachedToast?.message ?? null;
  }

  cacheEntry.lastFetchTime = Date.now();
  cacheEntry.lastAccessTime = cacheEntry.lastFetchTime;
  cacheEntry.inFlightPromise = (async () => {
    try {
      const out = await fetchFn();
      const result = out.message;
      const cache = out.cache ?? true;

      if (result === null) {
        cacheEntry.lastFetchTime = 0;
        cacheEntry.lastAccessTime = Date.now();
        return null;
      }

      if (!cache) {
        cacheEntry.lastFetchTime = 0;
        cacheEntry.lastAccessTime = Date.now();
        return result;
      }

      const now = Date.now();
      cacheEntry.cachedToast = {
        message: result,
        timestamp: now,
      };
      cacheEntry.lastAccessTime = now;

      return result;
    } finally {
      cacheEntry.inFlightPromise = null;
      if (!cacheEntry.cachedToast && cacheEntry.lastFetchTime === 0) {
        cacheEntries.delete(cacheKey);
      }
    }
  })();

  return cacheEntry.inFlightPromise;
}

/**
 * Clear one keyed entry, or the whole keyed cache if no key is provided.
 */
export function clearCache(cacheKey?: string): void {
  if (cacheKey) {
    cacheEntries.delete(cacheKey);
    return;
  }

  cacheEntries.clear();
}

/**
 * Force update a keyed cache entry with a new message.
 */
export function updateCache(cacheKey: string, message: string): void {
  const cacheEntry = getCacheEntry(cacheKey);
  const now = Date.now();
  cacheEntry.cachedToast = {
    message,
    timestamp: now,
  };
  cacheEntry.lastFetchTime = now;
  cacheEntry.lastAccessTime = now;
}
