import { afterEach, describe, expect, it, vi } from "vitest";

import { formatStatusRows } from "../src/lib/format.js";
import { buildSingleWindowPercentEntryDisplayName } from "../src/lib/status-entry-display.js";
import { SESSION_TOKEN_SECTION_HEADING } from "../src/lib/session-tokens-format.js";

describe("formatStatusRows", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a Copilot row", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "Copilot",
          percentRemaining: 75,
          resetTimeIso: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(out).toContain("Copilot");
    expect(out).toContain("75% left");
    expect(out).not.toContain("Status (remaining)");
    expect(out).not.toContain("Status (used)");
  });

  it("uses tiny layout when maxWidth is small", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 28, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "Copilot",
          percentRemaining: 100,
          resetTimeIso: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    // Tiny layout is single-line per entry (no bar characters)
    expect(out).toContain("Copilot");
    expect(out).not.toContain("█");
  });

  it("renders classic percent rows as used when percentDisplayMode is used", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 24, narrowAt: 16, tinyAt: 10 },
      percentDisplayMode: "used",
      entries: [
        {
          name: "Copilot",
          percentRemaining: 81,
          resetTimeIso: "2099-01-01T00:00:00.000Z",
        },
      ],
    });

    const lines = out.split("\n");
    const barLine = lines[1] ?? "";
    expect(barLine).toContain("19% used");
    expect(barLine).not.toContain("81% left");
    expect(out).not.toContain("Status (remaining)");
    expect(out).not.toContain("Status (used)");
    expect((barLine.match(/█/g) ?? []).length).toBeGreaterThan(0);
  });

  it("keeps percent text visible when classic percentVariant is bar", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      percentDisplayMode: "used",
      percentVariant: "bar",
      colorVariant: "auto",
      entries: [{ name: "Synthetic", percentRemaining: 26 }],
    });

    expect(out).toContain("█");
    expect(out).toContain("74% used");
  });

  it("renders over-status percentages above 100 in used mode", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 32, narrowAt: 24, tinyAt: 16 },
      percentDisplayMode: "used",
      entries: [
        {
          name: "Copilot",
          percentRemaining: -25,
          resetTimeIso: "2099-01-01T00:00:00.000Z",
        },
      ],
    });

    const lines = out.split("\n");
    const barLine = lines[1] ?? "";
    expect(barLine).toContain("125% used");
    expect((barLine.match(/░/g) ?? [])).toHaveLength(0);
  });

  it("floors over-status remaining labels at 0% left", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 32, narrowAt: 24, tinyAt: 16 },
      percentDisplayMode: "remaining",
      entries: [
        {
          name: "Copilot",
          percentRemaining: -25,
          resetTimeIso: "2099-01-01T00:00:00.000Z",
        },
      ],
    });

    const lines = out.split("\n");
    const barLine = lines[1] ?? "";
    expect(barLine).toContain("0% left");
    expect((barLine.match(/█/g) ?? [])).toHaveLength(0);
  });

  it("omits x/y usage summaries from classic percent rows", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "Synthetic",
          right: "0/135",
          percentRemaining: 100,
        },
        {
          name: "Qwen RPM",
          right: "5/60",
          percentRemaining: 92,
          resetTimeIso: "2099-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(out).toContain("Synthetic");
    expect(out).not.toContain("0/135");
    expect(out).toContain("Qwen RPM");
    expect(out).not.toContain("5/60");
    expect(out).toContain("92% left");
  });

  it("shows reset countdown when status is partially used", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "Copilot",
          percentRemaining: 75,
          resetTimeIso: "2099-01-01T00:00:00.000Z",
        },
      ],
    });

    // We don't assert exact time math; just that some countdown marker appears.
    expect(out).toMatch(/([\d.]+[dhms]|reset)/);
  });

  it("does not show reset countdown when status is fully available", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "Copilot",
          percentRemaining: 100,
          resetTimeIso: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(out).not.toMatch(/\d+[dhms]/);
  });

  it("uses detailed reset labels for single-window rows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "[Copilot] Monthly",
          percentRemaining: 56,
          resetTimeIso: "2026-01-15T12:14:00.000Z",
        },
      ],
    });

    expect(out).toContain("2h 14m");
    expect(out).not.toContain("2.5h");
  });

  it("uses detailed reset labels for grouped rows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

    const out = formatStatusRows({
      version: "1.0.0",
      style: "allWindows",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "OpenAI 5h",
          group: "OpenAI",
          label: "5h:",
          percentRemaining: 56,
          resetTimeIso: "2026-01-15T10:14:00.000Z",
        },
      ],
    });

    expect(out).toContain("14m");
    expect(out).not.toContain("0.5h");
  });

  it("normalizes grouped headers in all-window toast output", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));

    const out = formatStatusRows({
      version: "1.0.0",
      style: "allWindows",
      layout: { maxWidth: 80, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "Copilot",
          group: "Copilot (business)",
          label: "Usage:",
          kind: "value",
          value: "9 used | 2026-01 | org=acme-corp",
          resetTimeIso: "2026-01-16T00:00:00.000Z",
        },
      ],
    });

    expect(out).toContain("[Copilot] (business)");
    expect(out).not.toContain("→ ");
  });

  it("preserves grouped value-row labels and values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));

    const out = formatStatusRows({
      version: "1.0.0",
      style: "allWindows",
      layout: { maxWidth: 80, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "Copilot",
          group: "Copilot (business)",
          label: "Usage:",
          kind: "value",
          value: "9 used | 2026-01 | org=acme-corp",
          resetTimeIso: "2026-01-16T00:00:00.000Z",
        },
      ],
    });

    expect(out).toContain("Usage:");
    expect(out).toContain("9 used | 2026-01 | org=acme-corp");
    expect(out).not.toContain("Status window");
  });

  it("preserves explicit non-duration grouped percent labels", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      style: "allWindows",
      layout: { maxWidth: 80, narrowAt: 42, tinyAt: 32 },
      entries: [
        { name: "Copilot", group: "Copilot", label: "Status:", percentRemaining: 75 },
        { name: "Crof", group: "Crof", label: "Requests:", percentRemaining: 50 },
        { name: "Cursor API", group: "Cursor", label: "API:", percentRemaining: 25 },
      ],
    });

    expect(out).toContain("\nStatus ");
    expect(out).toContain("\nRequests ");
    expect(out).toContain("\nAPI ");
    expect(out).not.toContain("Status window");
  });

  it("uses Status window only for unlabeled grouped percent rows", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      style: "allWindows",
      layout: { maxWidth: 80, narrowAt: 42, tinyAt: 32 },
      entries: [{ name: "Unlabeled Provider", group: "Unlabeled Provider", percentRemaining: 75 }],
    });

    expect(out).toContain("Status window");
  });

  it("shares single-window provider/window display labels with classic formatting", () => {
    expect(
      buildSingleWindowPercentEntryDisplayName({
        name: "Copilot",
        group: "Copilot (personal)",
        label: "Monthly:",
        percentRemaining: 86,
      }),
    ).toBe("[Copilot] (personal) Monthly");

    expect(
      buildSingleWindowPercentEntryDisplayName({
        name: "[Copilot] (personal) Monthly",
        label: "Monthly:",
        percentRemaining: 86,
      }),
    ).toBe("[Copilot] (personal) Monthly");
  });

  it("renders grouped-header provider + window label in direct single-window formatter calls", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "Copilot",
          group: "Copilot (personal)",
          label: "Monthly:",
          percentRemaining: 86,
          resetTimeIso: "2099-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(out).toContain("[Copilot] (personal) Monthly");
  });

  it("preserves classic provider/account labels at sidebar width when they fit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 36, narrowAt: 36, tinyAt: 20 },
      entries: [
        {
          name: "[Copilot] (personal)",
          percentRemaining: 75,
          resetTimeIso: "2026-01-15T12:00:00.000Z",
        },
      ],
    });

    const lines = out.split("\n");
    expect(lines[0]).toContain("[Copilot] (personal)");
    expect(lines[1]).toContain("75% left");
    expect(lines.every((line) => line.length <= 36)).toBe(true);
  });

  it("preserves classic provider/account/window labels by shrinking reset padding", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 36, narrowAt: 36, tinyAt: 20 },
      entries: [
        {
          name: "[Copilot] (personal) Monthly",
          percentRemaining: 75,
          resetTimeIso: "2026-01-15T12:00:00.000Z",
        },
      ],
    });

    const lines = out.split("\n");
    expect(lines[0]).toContain("[Copilot] (personal) Monthly");
    expect(lines.every((line) => line.length <= 36)).toBe(true);
  });

  it("preserves classic value-row provider/account labels when they fit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 36, narrowAt: 36, tinyAt: 20 },
      entries: [
        {
          name: "[Copilot] (personal)",
          kind: "value",
          value: "Unlimited",
          resetTimeIso: "2026-01-15T12:00:00.000Z",
        },
      ],
    });

    const lines = out.split("\n");
    expect(lines[0]).toContain("[Copilot] (personal)");
    expect(lines[0]).toContain("Unlimited");
    expect(lines.every((line) => line.length <= 36)).toBe(true);
  });

  it("does not double-append window labels when single-window names are already preformatted", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "[Copilot] (personal) Monthly",
          label: "Monthly:",
          percentRemaining: 86,
          resetTimeIso: "2099-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(out).toContain("[Copilot] (personal) Monthly");
    expect(out).not.toContain("Monthly Monthly");
  });

  it("renders all-window status entries from shortest to longest within a provider group", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      style: "allWindows",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "OpenAI Weekly",
          group: "OpenAI (Pro)",
          label: "Weekly:",
          percentRemaining: 88,
        },
        {
          name: "OpenAI 5h",
          group: "OpenAI (Pro)",
          label: "5h:",
          percentRemaining: 92,
        },
      ],
    });

    expect(out.indexOf("Session")).toBeGreaterThanOrEqual(0);
    expect(out.indexOf("Weekly")).toBeGreaterThanOrEqual(0);
    expect(out).not.toContain("window");
    expect(out.indexOf("Session")).toBeLessThan(out.indexOf("Weekly"));
  });

  it("renders all-window percent rows as used when percentDisplayMode is used", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      style: "allWindows",
      layout: { maxWidth: 24, narrowAt: 16, tinyAt: 10 },
      percentDisplayMode: "used",
      entries: [
        {
          name: "OpenAI Weekly",
          group: "OpenAI (Pro)",
          label: "Weekly:",
          percentRemaining: 81,
          resetTimeIso: "2099-01-01T00:00:00.000Z",
        },
      ],
    });

    const barLine = out
      .split("\n")
      .find((line) => line.includes("%"));
    expect(barLine).toContain("19% used");
    expect(barLine).not.toContain("81% left");
    expect(out).not.toContain("Status (remaining)");
    expect(out).not.toContain("Status (used)");
    expect((barLine?.match(/█/g) ?? []).length).toBeGreaterThan(0);
  });

  it("renders all-window percent-row usage summaries when providers supply them", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      style: "allWindows",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "Synthetic 5h",
          group: "Synthetic",
          label: "5h:",
          right: "0/135",
          percentRemaining: 100,
        },
      ],
    });

    expect(out).toContain("Session");
    expect(out).not.toContain("5h window");
    expect(out).not.toContain("0/135");
    expect(out).toContain("100% left");
  });

  it("locks rendered all-window toast ordering for Qwen and OpenAI provider groups", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      style: "allWindows",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "Qwen Free Daily",
          group: "Qwen (free)",
          label: "Daily:",
          percentRemaining: 90,
        },
        {
          name: "OpenAI Weekly",
          group: "OpenAI (Pro)",
          label: "Weekly:",
          percentRemaining: 81,
        },
        {
          name: "Qwen Free RPM",
          group: "Qwen (free)",
          label: "RPM:",
          percentRemaining: 60,
        },
        {
          name: "OpenAI 5h",
          group: "OpenAI (Pro)",
          label: "5h:",
          percentRemaining: 42,
        },
      ],
    });

    expect(out.indexOf("[Qwen] (free)")).toBeGreaterThanOrEqual(0);
    expect(out.indexOf("[OpenAI] (Pro)")).toBeGreaterThanOrEqual(0);
    expect(out.indexOf("[Qwen] (free)")).toBeLessThan(out.indexOf("[OpenAI] (Pro)"));

    expect(out.indexOf("RPM")).toBeLessThan(out.indexOf("Daily"));
    expect(out.indexOf("Session")).toBeLessThan(out.indexOf("Weekly"));
    expect(out).not.toContain("window");
  });

  it("preserves explicit legacy Google-style labels and only falls back for unlabeled rows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));

    const out = formatStatusRows({
      version: "1.0.0",
      style: "allWindows",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      entries: [
        {
          name: "Claude (acct)",
          label: "Claude:",
          percentRemaining: 67,
          resetTimeIso: "2026-01-15T15:00:00.000Z",
        },
        {
          name: "G3Pro (acct)",
          percentRemaining: 67,
          resetTimeIso: "2026-01-15T15:00:00.000Z",
        },
      ],
    });

    expect(out).toContain("[Google Antigravity] (acct)");
    expect(out).toContain("\nClaude ");
    expect(out).toContain("Status window");
    expect(out).not.toContain("[Claude] (acct)");
    expect(out).not.toContain("[G3Pro] (acct)");
  });

  it("renders single-window session tokens as a one-line total summary", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      style: "singleWindow",
      layout: { maxWidth: 36, narrowAt: 32, tinyAt: 20 },
      entries: [],
      sessionTokens: {
        totalInput: 372,
        totalOutput: 41,
        models: [{ modelID: "openai/gpt-5.4-mini", input: 372, output: 41 }],
      },
    });

    expect(out.split("\n")).toEqual([SESSION_TOKEN_SECTION_HEADING, "  372 in  41 out"]);
    expect(out).not.toContain("openai/gpt-5.4-mini");
  });

  it("renders single-window session tokens with new and cached input totals when available", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      style: "singleWindow",
      layout: { maxWidth: 80, narrowAt: 32, tinyAt: 20 },
      entries: [],
      sessionTokens: {
        totalInput: 372,
        totalCachedInput: 120,
        totalCombinedInput: 492,
        totalOutput: 41,
        models: [
          {
            modelID: "openai/gpt-5.4-mini",
            input: 372,
            cachedInput: 120,
            totalInput: 492,
            output: 41,
          },
        ],
      },
    });

    expect(out.split("\n")).toEqual([
      SESSION_TOKEN_SECTION_HEADING,
      "  372 (120) in  41 out",
    ]);
  });

  it("renders all-window session tokens with detailed per-model rows", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      style: "allWindows",
      layout: { maxWidth: 36, narrowAt: 32, tinyAt: 20 },
      entries: [],
      sessionTokens: {
        totalInput: 372,
        totalOutput: 41,
        models: [{ modelID: "openai/gpt-5.4-mini", input: 372, output: 41 }],
      },
    });

    expect(out.split("\n")).toEqual([
      SESSION_TOKEN_SECTION_HEADING,
      "  openai/gpt-5.4-mini",
      "    372 in  41 out",
    ]);
  });

  it("renders all-window session tokens with separate new and cached input when available", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      style: "allWindows",
      layout: { maxWidth: 80, narrowAt: 32, tinyAt: 20 },
      entries: [],
      sessionTokens: {
        totalInput: 372,
        totalCachedInput: 120,
        totalCombinedInput: 492,
        totalOutput: 41,
        models: [
          {
            modelID: "openai/gpt-5.4-mini",
            input: 372,
            cachedInput: 120,
            totalInput: 492,
            output: 41,
          },
        ],
      },
    });

    expect(out.split("\n")).toEqual([
      SESSION_TOKEN_SECTION_HEADING,
      "  openai/gpt-5.4-mini   372 (120) in      41 out",
    ]);
  });

  it("keeps legacy style aliases working for direct formatter calls", () => {
    const aliasOutput = formatStatusRows({
      version: "1.0.0",
      style: "grouped",
      layout: { maxWidth: 36, narrowAt: 32, tinyAt: 20 },
      entries: [],
      sessionTokens: {
        totalInput: 372,
        totalOutput: 41,
        models: [{ modelID: "openai/gpt-5.4-mini", input: 372, output: 41 }],
      },
    });

    const canonicalOutput = formatStatusRows({
      version: "1.0.0",
      style: "allWindows",
      layout: { maxWidth: 36, narrowAt: 32, tinyAt: 20 },
      entries: [],
      sessionTokens: {
        totalInput: 372,
        totalOutput: 41,
        models: [{ modelID: "openai/gpt-5.4-mini", input: 372, output: 41 }],
      },
    });

    expect(aliasOutput).toBe(canonicalOutput);
  });

  it("renders box text variant with borders around rows", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 40, narrowAt: 32, tinyAt: 20 },
      textVariant: "box",
      entries: [
        { name: "Copilot", percentRemaining: 72, resetTimeIso: "2099-01-01T00:00:00.000Z" },
        { name: "OpenAI", percentRemaining: 34, resetTimeIso: "2099-01-01T00:00:00.000Z" },
      ],
    });

    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^┌[─]+┐$/);
    expect(lines[lines.length - 1]).toMatch(/^└[─]+┘$/);
    expect(out).toContain("Copilot");
    expect(out).toContain("OpenAI");
    expect(lines.every((line) => line.length <= 40)).toBe(true);
  });

  it("applies grouped visual variants in all-window output", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 40, narrowAt: 32, tinyAt: 20 },
      style: "allWindows",
      textVariant: "emoji",
      providerNameVariant: "icon",
      percentVariant: "number",
      colorVariant: "auto",
      entries: [
        { name: "Usage:", group: "Copilot", label: "Usage:", percentRemaining: 72, resetTimeIso: "2099-01-01T00:00:00.000Z" },
      ],
    });

    expect(out).toContain("[⌘ Copilot]");
    expect(out).toContain("🟢 Usage");
    expect(out).toContain("72% left");
    expect(out).not.toContain("█");
  });

  it("keeps percent text visible when grouped percentVariant is bar", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 40, narrowAt: 32, tinyAt: 20 },
      style: "allWindows",
      percentDisplayMode: "used",
      percentVariant: "bar",
      colorVariant: "auto",
      entries: [
        { name: "Usage:", group: "Copilot", label: "Usage:", percentRemaining: 26 },
      ],
    });

    expect(out).toContain("█");
    expect(out).toContain("74% used");
  });

  it("applies box text variant to grouped output", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 40, narrowAt: 32, tinyAt: 20 },
      style: "allWindows",
      textVariant: "box",
      entries: [
        { name: "Usage:", group: "Copilot", label: "Usage:", percentRemaining: 72, resetTimeIso: "2099-01-01T00:00:00.000Z" },
      ],
    });

    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^┌[─]+┐$/);
    expect(lines[lines.length - 1]).toMatch(/^└[─]+┘$/);
    expect(out).toContain("[Copilot]");
    expect(lines.every((line) => line.length <= 40)).toBe(true);
  });

  it("keeps grouped minimal rows within maxWidth", () => {
    const out = formatStatusRows({
      version: "1.0.0",
      layout: { maxWidth: 36, narrowAt: 32, tinyAt: 20 },
      style: "allWindows",
      textVariant: "minimal",
      providerNameVariant: "short",
      entries: [
        { name: "Usage:", group: "Copilot", label: "Usage:", percentRemaining: 72, resetTimeIso: "2099-01-01T00:00:00.000Z" },
        { name: "Weekly", group: "OpenAI", label: "Weekly:", percentRemaining: 34, resetTimeIso: "2099-01-01T00:00:00.000Z" },
      ],
    });

    expect(out).toContain("[Copilot]");
    expect(out).toContain("Usage");
    expect(out).toContain("72% left");
    expect(out.split("\n").every((line) => line.length <= 36)).toBe(true);
  });
});
