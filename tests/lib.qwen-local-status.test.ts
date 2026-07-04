import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/opencode-runtime-paths.js", () => ({
  getOpencodeRuntimeDirs: () => ({
    dataDir: "/home/test/.local/share/opencode",
    configDir: "/home/test/.config/opencode",
    cacheDir: "/home/test/.cache/opencode",
    stateDir: "/home/test/.local/state/opencode",
  }),
}));

vi.mock("fs/promises", () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

describe("qwen-local-status", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  it("returns a default state when file is missing", async () => {
    vi.setSystemTime(new Date("2026-02-24T12:00:00.000Z"));
    const fs = await import("fs/promises");
    (fs.readFile as any).mockRejectedValueOnce(new Error("missing"));

    const { computeQwenStatus, readQwenLocalStatusState } = await import("../src/lib/qwen-local-status.js");
    const state = await readQwenLocalStatusState();
    const status = computeQwenStatus({ state });

    expect(state.utcDay).toBe("2026-02-24");
    expect(state.dayCount).toBe(0);
    expect(state.recent).toEqual([]);
    expect(status.day.used).toBe(0);
    expect(status.day.percentRemaining).toBe(100);
    expect(status.rpm.used).toBe(0);
    expect(status.rpm.percentRemaining).toBe(100);
    expect(status.day.resetTimeIso).toBe("2026-02-25T00:00:00.000Z");
  });

  it("resets day counter at UTC midnight when recording a completion", async () => {
    vi.setSystemTime(new Date("2026-02-24T00:00:10.000Z"));
    const fs = await import("fs/promises");

    (fs.readFile as any).mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        utcDay: "2026-02-23",
        dayCount: 42,
        recent: [Date.now() - 10_000],
        updatedAt: Date.now() - 60_000,
      }),
    );

    const { recordQwenCompletion } = await import("../src/lib/qwen-local-status.js");
    const next = await recordQwenCompletion();

    expect(next.utcDay).toBe("2026-02-24");
    expect(next.dayCount).toBe(1);
    expect(next.recent.length).toBe(2);

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const [, payload] = (fs.writeFile as any).mock.calls[0];
    const persisted = JSON.parse(payload as string);
    expect(persisted.dayCount).toBe(1);
    expect(persisted.utcDay).toBe("2026-02-24");
    expect(fs.rename).toHaveBeenCalledTimes(1);
  });

  it("computes RPM from timestamps in the last 60 seconds", async () => {
    vi.setSystemTime(new Date("2026-02-24T12:00:00.000Z"));

    const now = Date.now();
    const { computeQwenStatus } = await import("../src/lib/qwen-local-status.js");
    const status = computeQwenStatus({
      nowMs: now,
      state: {
        version: 1,
        utcDay: "2026-02-24",
        dayCount: 50,
        recent: [now - 61_000, now - 30_000, now - 1_000],
        updatedAt: now,
      },
    });

    expect(status.rpm.used).toBe(2);
    expect(status.rpm.limit).toBe(60);
    expect(status.rpm.percentRemaining).toBe(97);
    expect(status.rpm.resetTimeIso).toBe(new Date(now - 30_000 + 60_000).toISOString());
  });

  it("computes alibaba coding plan rolling windows", async () => {
    vi.setSystemTime(new Date("2026-02-24T12:00:00.000Z"));

    const now = Date.now();
    const { computeAlibabaCodingPlanStatus } = await import("../src/lib/qwen-local-status.js");
    const status = computeAlibabaCodingPlanStatus({
      nowMs: now,
      tier: "lite",
      state: {
        version: 1,
        recent: [
          now - 31 * 24 * 60 * 60 * 1000,
          now - 6 * 24 * 60 * 60 * 1000,
          now - 60 * 60 * 1000,
          now - 5 * 60 * 1000,
        ],
        updatedAt: now,
      },
    });

    expect(status.fiveHour.used).toBe(2);
    expect(status.fiveHour.limit).toBe(1200);
    expect(status.weekly.used).toBe(3);
    expect(status.weekly.limit).toBe(9000);
    expect(status.monthly.used).toBe(3);
    expect(status.monthly.limit).toBe(18000);
    expect(status.fiveHour.resetTimeIso).toBe(new Date(now - 60 * 60 * 1000 + 5 * 60 * 60 * 1000).toISOString());
  });

  it("records alibaba coding plan completions in a separate rolling state file", async () => {
    vi.setSystemTime(new Date("2026-02-24T12:00:00.000Z"));
    const fs = await import("fs/promises");
    const now = Date.now();

    (fs.readFile as any).mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        recent: [now - 15_000],
        updatedAt: now - 15_000,
      }),
    );

    const { recordAlibabaCodingPlanCompletion } = await import("../src/lib/qwen-local-status.js");
    const next = await recordAlibabaCodingPlanCompletion();

    expect(next.recent).toHaveLength(2);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const [, payload] = (fs.writeFile as any).mock.calls[0];
    const persisted = JSON.parse(payload as string);
    expect(persisted.recent).toHaveLength(2);
  });

  it("replaces destination when rename fails on existing file", async () => {
    vi.setSystemTime(new Date("2026-02-24T12:00:00.000Z"));
    const fs = await import("fs/promises");
    const now = Date.now();

    (fs.readFile as any).mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        utcDay: "2026-02-24",
        dayCount: 3,
        recent: [now - 20_000],
        updatedAt: now - 20_000,
      }),
    );

    const renameError = Object.assign(new Error("destination exists"), { code: "EPERM" });
    (fs.rename as any).mockRejectedValueOnce(renameError).mockResolvedValueOnce(undefined);

    const { recordQwenCompletion } = await import("../src/lib/qwen-local-status.js");
    const next = await recordQwenCompletion();

    expect(next.dayCount).toBe(4);
    expect(fs.rm).toHaveBeenCalledTimes(1);
    expect(fs.rename).toHaveBeenCalledTimes(2);
  });
});
