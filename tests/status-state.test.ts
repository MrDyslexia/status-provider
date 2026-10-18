import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readdir, rm, writeFile } from "fs/promises";

const TEST_RUNTIME_ROOT = "/tmp/status-provider-state-tests";
const evidence = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("../src/lib/anthropic-diagnostic-log.js", () => ({ logAnthropicDiagnostic: evidence.log }));

vi.mock("../src/lib/opencode-runtime-paths.js", () => ({
  getOpencodeRuntimeDirs: () => ({
    dataDir: `${TEST_RUNTIME_ROOT}/data`,
    configDir: `${TEST_RUNTIME_ROOT}/config`,
    cacheDir: `${TEST_RUNTIME_ROOT}/cache`,
    stateDir: `${TEST_RUNTIME_ROOT}/state`,
  }),
}));

function createTestContext() {
  return {
    client: {
      config: {
        providers: async () => ({ data: { providers: [] } }),
        get: async () => ({ data: {} }),
      },
    },
    config: {
      googleModels: ["CLAUDE"],
      anthropicBinaryPath: "claude",
      alibabaCodingPlanTier: "lite",
      cursorPlan: "none",
      onlyCurrentModel: false,
    },
  } as any;
}

describe("status-state shared cache", () => {
  beforeEach(async () => {
    evidence.log.mockClear();
    vi.restoreAllMocks();
    vi.resetModules();
    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
  });

  it("records disappearance, error TTL, recovery and Anthropic-only cache decisions", async () => {
    const { fetchStatusProviderResult } = await import("../src/lib/status-state.js");
    const ctx = createTestContext();
    ctx.config.anthropicDiagnosticLogging = true;
    const success = {
      attempted: true,
      entries: [{ name: "quota-canary", percentRemaining: 55 }],
      errors: [],
    };
    const error = {
      attempted: true,
      entries: [],
      errors: [{ label: "Claude", message: "error-canary" }],
    };
    const provider = {
      id: "anthropic",
      isAvailable: vi.fn(),
      fetch: vi
        .fn()
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce(error)
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce({ attempted: false, entries: [], errors: [] }),
    };
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const fetch = () => fetchStatusProviderResult({ provider, ctx, ttlMs: 300_000 });
    await fetch();
    now.mockReturnValue(1_800_000_300_001);
    expect((await fetch()).entries).toEqual([]);
    await fetch();
    expect(evidence.log).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ outcome: "hit", remainingTtlMs: 300_000, hasData: false }),
    );
    now.mockReturnValue(1_800_000_600_002);
    expect((await fetch()).entries).toEqual(success.entries);
    now.mockReturnValue(1_800_000_900_003);
    expect((await fetch()).attempted).toBe(false);
    const outcomes = evidence.log.mock.calls.map(([, event]) => event.outcome);
    expect(outcomes).toEqual(
      expect.arrayContaining(["miss", "expiry", "error", "recovery", "unattempted-deletion"]),
    );
    expect(JSON.stringify(evidence.log.mock.calls)).not.toMatch(
      /quota-canary|error-canary|anthropicBinaryPath|session/,
    );
    evidence.log.mockClear();
    await fetchStatusProviderResult({
      provider: { ...provider, id: "synthetic", fetch: vi.fn().mockResolvedValue(success) },
      ctx,
      ttlMs: 300_000,
    });
    expect(evidence.log).not.toHaveBeenCalled();
  });

  it("records rate-limit stale fallback, bypass and in-flight dedup without changing results", async () => {
    const { fetchStatusProviderResult } = await import("../src/lib/status-state.js");
    const ctx = createTestContext();
    ctx.config.anthropicDiagnosticLogging = true;
    const success = {
      attempted: true,
      entries: [{ name: "Claude", percentRemaining: 55 }],
      errors: [],
    };
    const provider = {
      id: "anthropic",
      isAvailable: vi.fn(),
      fetch: vi
        .fn()
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce({
          attempted: true,
          entries: [],
          errors: [],
          rateLimitedUntil: Date.now() + 300_000,
        }),
    };
    await fetchStatusProviderResult({ provider, ctx, ttlMs: 0 });
    expect((await fetchStatusProviderResult({ provider, ctx, ttlMs: 0 })).entries).toEqual(
      success.entries,
    );
    expect(evidence.log).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ outcome: "stale-fallback" }),
    );
    provider.fetch.mockResolvedValue(success);
    await fetchStatusProviderResult({ provider, ctx, ttlMs: 0, bypassCache: true });
    expect(evidence.log).toHaveBeenCalledWith(true, expect.objectContaining({ outcome: "bypass" }));
    let release!: (value: typeof success) => void;
    provider.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = fetchStatusProviderResult({ provider, ctx, ttlMs: 0 });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const second = fetchStatusProviderResult({ provider, ctx, ttlMs: 0 });
    await vi.waitFor(() =>
      expect(evidence.log).toHaveBeenCalledWith(
        true,
        expect.objectContaining({ outcome: "dedup" }),
      ),
    );
    release(success);
    await Promise.all([first, second]);
  });

  it("builds a provider cache key that ignores formatStyle-like extras", async () => {
    const { buildStatusProviderStateCacheKey } = await import("../src/lib/status-state.js");
    const base = createTestContext();

    const singleWindowKey = buildStatusProviderStateCacheKey("synthetic", {
      ...base,
      config: { ...base.config, formatStyle: "singleWindow" },
    } as any);
    const allWindowsKey = buildStatusProviderStateCacheKey("synthetic", {
      ...base,
      config: { ...base.config, formatStyle: "allWindows" },
    } as any);

    expect(singleWindowKey).toBe(allWindowsKey);
  });

  it("returns cache-owned clones for repeated non-live provider reads", async () => {
    const { __resetStatusStateForTests, fetchStatusProviderResult } =
      await import("../src/lib/status-state.js");
    __resetStatusStateForTests();

    const provider = {
      id: "synthetic",
      isAvailable: vi.fn(),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [
          {
            name: "Synthetic Weekly",
            group: "Synthetic",
            label: "Weekly:",
            percentRemaining: 84,
            right: "$8/$50",
            resetTimeIso: "2026-04-21T18:00:00.000Z",
          },
        ],
        errors: [],
        presentation: {
          singleWindowShowRight: true,
        },
      }),
    } as any;

    const first = await fetchStatusProviderResult({
      provider,
      ctx: createTestContext(),
      ttlMs: 60_000,
    });
    const firstEntry = first.entries[0] as any;
    firstEntry.right = "$0/$1";
    firstEntry.percentRemaining = 1;

    const second = await fetchStatusProviderResult({
      provider,
      ctx: createTestContext(),
      ttlMs: 60_000,
    });

    expect(second).toEqual({
      attempted: true,
      entries: [
        {
          name: "Synthetic Weekly",
          group: "Synthetic",
          label: "Weekly:",
          percentRemaining: 84,
          right: "$8/$50",
          resetTimeIso: "2026-04-21T18:00:00.000Z",
        },
      ],
      errors: [],
      presentation: {
        singleWindowShowRight: true,
      },
    });
    expect(provider.fetch).toHaveBeenCalledTimes(1);
  });

  it("reuses the persisted cache across module resets", async () => {
    const statusStateA = await import("../src/lib/status-state.js");
    statusStateA.__resetStatusStateForTests();

    const provider = {
      id: "synthetic",
      isAvailable: vi.fn(),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ name: "Synthetic", percentRemaining: 55 }],
        errors: [],
      }),
    } as any;

    await statusStateA.fetchStatusProviderResult({
      provider,
      ctx: createTestContext(),
      ttlMs: 60_000,
    });
    expect(provider.fetch).toHaveBeenCalledTimes(1);

    vi.resetModules();
    const statusStateB = await import("../src/lib/status-state.js");
    const second = await statusStateB.fetchStatusProviderResult({
      provider,
      ctx: createTestContext(),
      ttlMs: 60_000,
    });

    expect(second).toEqual({
      attempted: true,
      entries: [{ name: "Synthetic", percentRemaining: 55 }],
      errors: [],
    });
    expect(provider.fetch).toHaveBeenCalledTimes(1);
  });

  it("accepts persisted legacy classic presentation fields for cache compatibility", async () => {
    const statusStateA = await import("../src/lib/status-state.js");
    statusStateA.__resetStatusStateForTests();

    const provider = {
      id: "synthetic",
      isAvailable: vi.fn(),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ name: "Synthetic", percentRemaining: 55 }],
        errors: [],
      }),
    } as any;
    const ctx = createTestContext();
    const key = statusStateA.buildStatusProviderStateCacheKey(provider.id, ctx);
    const path = statusStateA.getStatusProviderStateCacheFilePath(provider.id, key);
    const { getPackageVersion } = await import("../src/lib/version.js");
    const packageVersion = (await getPackageVersion()) ?? "unknown";

    await mkdir(`${TEST_RUNTIME_ROOT}/cache/status-provider-state`, { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        packageVersion,
        key,
        providerId: provider.id,
        timestamp: Date.now(),
        result: {
          attempted: true,
          entries: [{ name: "Synthetic", percentRemaining: 55 }],
          errors: [],
          presentation: {
            classicDisplayName: "Synthetic",
            classicShowRight: true,
            classicStrategy: "preserve",
          },
        },
      }),
      "utf-8",
    );

    vi.resetModules();
    const statusStateB = await import("../src/lib/status-state.js");
    const result = await statusStateB.fetchStatusProviderResult({ provider, ctx, ttlMs: 60_000 });

    expect(result).toEqual({
      attempted: true,
      entries: [{ name: "Synthetic", percentRemaining: 55 }],
      errors: [],
      presentation: {
        classicDisplayName: "Synthetic",
        classicShowRight: true,
        classicStrategy: "preserve",
      },
    });
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it("treats cache corruption as a miss and refetches live data", async () => {
    const statusStateA = await import("../src/lib/status-state.js");
    statusStateA.__resetStatusStateForTests();

    const provider = {
      id: "synthetic",
      isAvailable: vi.fn(),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ name: "Synthetic", percentRemaining: 55 }],
        errors: [],
      }),
    } as any;
    const ctx = createTestContext();
    const key = statusStateA.buildStatusProviderStateCacheKey(provider.id, ctx);
    const path = statusStateA.getStatusProviderStateCacheFilePath(provider.id, key);

    await statusStateA.fetchStatusProviderResult({ provider, ctx, ttlMs: 60_000 });
    await writeFile(path, "{ definitely-not-json", "utf-8");

    vi.resetModules();
    const statusStateB = await import("../src/lib/status-state.js");
    await statusStateB.fetchStatusProviderResult({ provider, ctx, ttlMs: 60_000 });

    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it("treats cache package-version mismatches as a miss and refetches live data", async () => {
    const statusStateA = await import("../src/lib/status-state.js");
    statusStateA.__resetStatusStateForTests();

    const provider = {
      id: "synthetic",
      isAvailable: vi.fn(),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ name: "Synthetic", percentRemaining: 55 }],
        errors: [],
      }),
    } as any;
    const ctx = createTestContext();
    const key = statusStateA.buildStatusProviderStateCacheKey(provider.id, ctx);
    const path = statusStateA.getStatusProviderStateCacheFilePath(provider.id, key);

    await statusStateA.fetchStatusProviderResult({ provider, ctx, ttlMs: 60_000 });
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        packageVersion: "0.0.0-stale-cache",
        key,
        providerId: provider.id,
        timestamp: Date.now(),
        result: {
          attempted: true,
          entries: [{ name: "Synthetic", percentRemaining: 10 }],
          errors: [],
        },
      }),
      "utf-8",
    );

    vi.resetModules();
    const statusStateB = await import("../src/lib/status-state.js");
    await statusStateB.fetchStatusProviderResult({ provider, ctx, ttlMs: 60_000 });

    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it("treats cache version mismatches as a miss and refetches live data", async () => {
    const statusStateA = await import("../src/lib/status-state.js");
    statusStateA.__resetStatusStateForTests();

    const provider = {
      id: "synthetic",
      isAvailable: vi.fn(),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ name: "Synthetic", percentRemaining: 55 }],
        errors: [],
      }),
    } as any;
    const ctx = createTestContext();
    const key = statusStateA.buildStatusProviderStateCacheKey(provider.id, ctx);
    const path = statusStateA.getStatusProviderStateCacheFilePath(provider.id, key);

    await statusStateA.fetchStatusProviderResult({ provider, ctx, ttlMs: 60_000 });
    await writeFile(
      path,
      JSON.stringify({
        version: 999,
        key,
        providerId: provider.id,
        timestamp: Date.now(),
        result: {
          attempted: true,
          entries: [{ name: "Synthetic", percentRemaining: 10 }],
          errors: [],
        },
      }),
      "utf-8",
    );

    vi.resetModules();
    const statusStateB = await import("../src/lib/status-state.js");
    await statusStateB.fetchStatusProviderResult({ provider, ctx, ttlMs: 60_000 });

    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it("bypasses persistence entirely for live-local providers", async () => {
    const { __resetStatusStateForTests, fetchStatusProviderResult } =
      await import("../src/lib/status-state.js");
    __resetStatusStateForTests();

    const provider = {
      id: "qwen-code",
      isAvailable: vi.fn(),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ name: "Qwen Free Daily", percentRemaining: 99 }],
        errors: [],
      }),
    } as any;

    await fetchStatusProviderResult({
      provider,
      ctx: createTestContext(),
      ttlMs: 60_000,
    });
    await fetchStatusProviderResult({
      provider,
      ctx: createTestContext(),
      ttlMs: 60_000,
    });

    await expect(readdir(`${TEST_RUNTIME_ROOT}/cache/status-provider-state`)).rejects.toThrow();
    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it("re-fetches a retryable auth-error result well before the full TTL elapses", async () => {
    vi.useFakeTimers();
    try {
      const { __resetStatusStateForTests, fetchStatusProviderResult } =
        await import("../src/lib/status-state.js");
      __resetStatusStateForTests();

      const provider = {
        id: "synthetic",
        isAvailable: vi.fn(),
        fetch: vi.fn().mockResolvedValue({
          attempted: true,
          entries: [],
          errors: [{ label: "OpenAI", message: "Token expired", retryable: true }],
        }),
      } as any;

      await fetchStatusProviderResult({ provider, ctx: createTestContext(), ttlMs: 300_000 });
      expect(provider.fetch).toHaveBeenCalledTimes(1);

      // Still well within the 5-minute ttlMs, but past the short retryable-error
      // window — a plain success/failure would still be served from cache here.
      await vi.advanceTimersByTimeAsync(11_000);

      await fetchStatusProviderResult({ provider, ctx: createTestContext(), ttlMs: 300_000 });
      expect(provider.fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves a non-retryable error from cache for the full ttlMs like before", async () => {
    vi.useFakeTimers();
    try {
      const { __resetStatusStateForTests, fetchStatusProviderResult } =
        await import("../src/lib/status-state.js");
      __resetStatusStateForTests();

      const provider = {
        id: "synthetic",
        isAvailable: vi.fn(),
        fetch: vi.fn().mockResolvedValue({
          attempted: true,
          entries: [],
          errors: [{ label: "OpenAI", message: "No status data" }],
        }),
      } as any;

      await fetchStatusProviderResult({ provider, ctx: createTestContext(), ttlMs: 300_000 });
      await vi.advanceTimersByTimeAsync(11_000);
      await fetchStatusProviderResult({ provider, ctx: createTestContext(), ttlMs: 300_000 });

      expect(provider.fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
