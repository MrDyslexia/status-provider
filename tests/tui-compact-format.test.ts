import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCompactStatusStatusLine } from "../src/lib/tui-compact-format.js";

describe("buildCompactStatusStatusLine", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats percent entries with text-only remaining percent semantics", () => {
    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 96,
      data: {
        entries: [
          {
            name: "Copilot rolling window",
            group: "Copilot",
            label: "5h:",
            percentRemaining: 82,
          },
        ],
        errors: [],
      },
    });

    expect(line).toBe("Copilot 82%");
  });

  it("formats used percent mode with text-only percentages", () => {
    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "used",
      maxWidth: 96,
      data: {
        entries: [
          {
            name: "Copilot rolling window",
            group: "Copilot",
            label: "5h:",
            percentRemaining: 82,
          },
        ],
        errors: [],
      },
    });

    expect(line).toBe("Copilot 18%");
  });

  it("preserves Gemini CLI model tiers in grouped compact status", () => {
    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 96,
      data: {
        entries: [
          { name: "Gemini Pro", group: "Gemini CLI", label: "Gemini Pro:", percentRemaining: 20 },
          {
            name: "Gemini Flash",
            group: "Gemini CLI",
            label: "Gemini Flash:",
            percentRemaining: 50,
          },
          {
            name: "Gemini Flash Lite",
            group: "Gemini CLI",
            label: "Gemini Flash Lite:",
            percentRemaining: 10,
          },
        ],
        errors: [],
      },
    });

    expect(line).toBe("Gemini CLI Gemini Pro 20%, Gemini Flash 50%, Gemini Flash Lite 10%");
  });

  it("preserves explicit non-duration compact labels when multiple rows share a provider", () => {
    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 96,
      data: {
        entries: [
          { name: "Cursor API", group: "Cursor", label: "API:", percentRemaining: 25 },
          { name: "Cursor Requests", group: "Cursor", label: "Requests:", percentRemaining: 50 },
          { name: "Kimi Code Fast", group: "Kimi Code", label: "Fast:", percentRemaining: 80 },
          { name: "Kimi Code Slow", group: "Kimi Code", label: "Slow:", percentRemaining: 40 },
        ],
        errors: [],
      },
    });

    expect(line).toBe("Cursor API 25%, Requests 50% | Kimi Code Fast 80%, Slow 40%");
  });

  it("groups multiple percent windows under one provider with compact window labels", () => {
    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 96,
      data: {
        entries: [
          {
            name: "OpenAI rolling window",
            group: "OpenAI (pro)",
            label: "5h:",
            percentRemaining: 100,
          },
          {
            name: "OpenAI weekly window",
            group: "OpenAI (pro)",
            label: "Weekly:",
            percentRemaining: 100,
          },
        ],
        errors: [],
      },
    });

    expect(line).toBe("OpenAI Pro 5h 100%, 7d 100%");
  });

  it("keeps compact status provider labels intentionally short", () => {
    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 96,
      data: {
        entries: [
          {
            name: "Copilot rolling window",
            group: "Copilot (personal)",
            label: "5h:",
            percentRemaining: 75,
          },
        ],
        errors: [],
      },
    });

    expect(line).toBe("Copilot 75%");
    expect(line).not.toContain("[Copilot] (personal)");
  });

  it("appends a detailed reset countdown to a single-window percent entry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 96,
      data: {
        entries: [
          {
            name: "OpenAI weekly window",
            group: "OpenAI (pro)",
            label: "Weekly:",
            percentRemaining: 36,
            resetTimeIso: "2026-01-07T15:10:00.000Z",
          },
        ],
        errors: [],
      },
    });

    expect(line).toBe("OpenAI Pro 36% 6d 15h 10m");
  });

  it("appends a detailed reset countdown to each window in a multi-window group", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 96,
      data: {
        entries: [
          {
            name: "OpenAI rolling window",
            group: "OpenAI (pro)",
            label: "5h:",
            percentRemaining: 82,
            resetTimeIso: "2026-01-01T04:00:00.000Z",
          },
          {
            name: "OpenAI weekly window",
            group: "OpenAI (pro)",
            label: "Weekly:",
            percentRemaining: 40,
            resetTimeIso: "2026-01-04T00:00:00.000Z",
          },
        ],
        errors: [],
      },
    });

    expect(line).toBe("OpenAI Pro 5h 82% 4h 0m, 7d 40% 3d 0h 0m");
  });

  it("omits the reset countdown when the entry is at 100% remaining", () => {
    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 96,
      data: {
        entries: [
          {
            name: "Claude Sonnet",
            percentRemaining: 100,
            resetTimeIso: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
          },
        ],
        errors: [],
      },
    });

    expect(line).toBe("Claude Sonnet 100%");
  });

  it("appends a detailed reset countdown to value entries when present", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 96,
      data: {
        entries: [
          {
            kind: "value",
            name: "Cursor API",
            value: "$2.40 / $20.00",
            resetTimeIso: "2026-01-14T00:00:00.000Z",
          },
        ],
        errors: [],
      },
    });

    expect(line).toBe("Cursor API - $2.40 / $20.00 13d 0h 0m");
  });

  it("formats value entries without percent mode changing the value", () => {
    const remaining = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 96,
      data: {
        entries: [
          {
            kind: "value",
            name: "Cursor API",
            value: "$2.40 / $20.00",
          },
        ],
        errors: [],
      },
    });
    const used = buildCompactStatusStatusLine({
      percentDisplayMode: "used",
      maxWidth: 96,
      data: {
        entries: [
          {
            kind: "value",
            name: "Cursor API",
            value: "$2.40 / $20.00",
          },
        ],
        errors: [],
      },
    });

    expect(remaining).toBe("Cursor API - $2.40 / $20.00");
    expect(used).toBe(remaining);
  });

  it("joins multiple entry and session-token aggregate segments", () => {
    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 96,
      data: {
        entries: [
          {
            name: "Copilot rolling window",
            group: "Copilot",
            label: "5h:",
            percentRemaining: 82,
          },
          {
            kind: "value",
            name: "Cursor API",
            value: "$2.40",
          },
        ],
        errors: [],
        sessionTokens: {
          models: [
            {
              modelID: "openai/gpt-5",
              input: 12_400,
              cachedInput: 5_600,
              totalInput: 18_000,
              output: 3_100,
            },
          ],
          totalInput: 12_400,
          totalCachedInput: 5_600,
          totalCombinedInput: 18_000,
          totalOutput: 3_100,
        },
      },
    });

    expect(line).toBe("Copilot 82% | Cursor API - $2.40 | tok 12.4K (5.6K) in / 3.1K out");
  });

  it("summarizes errors as issue counts when status segments exist and the count fits", () => {
    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 96,
      data: {
        entries: [
          {
            name: "Copilot",
            percentRemaining: 75,
          },
        ],
        errors: [
          { label: "OpenAI", message: "Not configured" },
          { label: "Cursor", message: "Unavailable" },
        ],
      },
    });

    expect(line).toBe("Copilot 75% | +2 issues");
  });

  it("renders the first error with a remaining count when no status segments exist", () => {
    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 96,
      data: {
        entries: [],
        errors: [
          { label: "OpenAI", message: "Not configured" },
          { label: "Cursor", message: "Unavailable" },
        ],
      },
    });

    expect(line).toBe("OpenAI: Not configured +1");
  });

  it("omits the issue count when status segments exist but the count does not fit", () => {
    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: "Copilot 75%".length,
      data: {
        entries: [
          {
            name: "Copilot",
            percentRemaining: 75,
          },
        ],
        errors: [{ label: "OpenAI", message: "Not configured" }],
      },
    });

    expect(line).toBe("Copilot 75%");
  });

  it("collapses whitespace, sanitizes control text, and truncates with ellipsis", () => {
    const line = buildCompactStatusStatusLine({
      percentDisplayMode: "remaining",
      maxWidth: 18,
      data: {
        entries: [
          {
            name: "Open\u001b[31mAI\nProvider",
            percentRemaining: 42,
          },
        ],
        errors: [{ label: "Err\u0007", message: "Bad\u0003" }],
      },
    });

    expect(line).toBe("OpenAI Provider 4…");
    expect(line.length).toBeLessThanOrEqual(18);
    expect(line).not.toContain("\n");
    expect(line).not.toContain("\u001b");
    expect(line).not.toContain("\u0007");
    expect(line).not.toContain("\u0003");
  });
});
