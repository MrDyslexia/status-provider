import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSidebarStatusPanelLines } from "../src/lib/tui-sidebar-format.js";

const baseConfig = {
  formatStyle: "singleWindow",
  percentDisplayMode: "remaining",
  textVariant: "default",
  providerNameVariant: "full",
  percentVariant: "both",
  colorVariant: "none",
  alignmentVariant: "left",
} as const;

function singleWindowData() {
  return {
    entries: [
      {
        name: "OpenAI",
        percentRemaining: 34,
        resetTimeIso: "2026-01-15T12:00:00.000Z",
      },
      {
        name: "Kimi Code",
        percentRemaining: 72,
        resetTimeIso: "2026-01-15T12:00:00.000Z",
      },
    ],
    errors: [],
    sessionTokens: undefined,
  };
}

function allWindowsData() {
  return {
    entries: [
      {
        name: "OpenAI 5h",
        group: "OpenAI (Pro)",
        label: "5h:",
        percentRemaining: 34,
        resetTimeIso: "2026-01-15T12:00:00.000Z",
      },
      {
        name: "OpenAI Weekly",
        group: "OpenAI (Pro)",
        label: "Weekly:",
        percentRemaining: 72,
        resetTimeIso: "2026-01-15T12:00:00.000Z",
      },
    ],
    errors: [],
    sessionTokens: undefined,
  };
}

describe("sidebar config variants", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("formatStyle", () => {
    it("singleWindow renders one row per provider", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, formatStyle: "singleWindow" },
      });

      expect(lines).toMatchSnapshot();
      expect(lines.join("\n")).toContain("OpenAI");
      expect(lines.join("\n")).toContain("Kimi Code");
      expect(lines.join("\n")).not.toContain("[OpenAI]");
    });

    it("allWindows renders grouped windows under a provider header", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: allWindowsData(),
        config: { ...baseConfig, formatStyle: "allWindows" },
      });

      expect(lines).toMatchSnapshot();
      expect(lines.join("\n")).toContain("[OpenAI] (Pro)");
      expect(lines.join("\n")).toContain("Session");
      expect(lines.join("\n")).toContain("Weekly");
    });
  });

  describe("percentDisplayMode", () => {
    it("remaining shows percent remaining", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, percentDisplayMode: "remaining" },
      });

      expect(lines.join("\n")).toContain("34% left");
      expect(lines.join("\n")).toContain("72% left");
    });

    it("used shows percent used", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, percentDisplayMode: "used" },
      });

      expect(lines.join("\n")).toContain("66% used");
      expect(lines.join("\n")).toContain("28% used");
    });
  });

  describe("textVariant", () => {
    it("default renders two-line rows", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, textVariant: "default" },
      });

      expect(lines).toMatchSnapshot();
      expect(lines.join("\n")).toContain("OpenAI");
      expect(lines.join("\n")).toContain("34% left");
    });

    it("minimal renders single-line rows", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, textVariant: "minimal" },
      });

      expect(lines).toMatchSnapshot();
      expect(lines.join("\n")).toContain("OpenAI");
      expect(lines.join("\n")).toContain("34% left");
      expect(lines.join("\n")).not.toMatch(/\d+h\s*\d+m/);
    });

    it("box wraps rows in a border", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, textVariant: "box" },
      });

      expect(lines).toMatchSnapshot();
      expect(lines[0]).toMatch(/^┌[─]+┐$/);
      expect(lines[lines.length - 1]).toMatch(/^└[─]+┘$/);
    });

    it("emoji prefixes rows with status emoji", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, textVariant: "emoji" },
      });

      expect(lines).toMatchSnapshot();
      expect(lines.join("\n")).toContain("🟡 OpenAI");
      expect(lines.join("\n")).toContain("🟢 Kimi Code");
    });
  });

  describe("providerNameVariant", () => {
    it("full uses the provider display name", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, providerNameVariant: "full" },
      });

      expect(lines.join("\n")).toContain("OpenAI");
      expect(lines.join("\n")).toContain("Kimi Code");
    });

    it("short uses short labels where available", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, providerNameVariant: "short" },
      });

      expect(lines).toMatchSnapshot();
      expect(lines.join("\n")).toContain("OpenAI");
      expect(lines.join("\n")).toContain("Kimi");
      expect(lines.join("\n")).not.toContain("Kimi Code");
    });

    it("icon prefixes names with provider icons", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, providerNameVariant: "icon" },
      });

      expect(lines).toMatchSnapshot();
      expect(lines.join("\n")).toContain("◎ OpenAI");
      expect(lines.join("\n")).toContain("◐ Kimi");
    });
  });

  describe("percentVariant", () => {
    it("number omits the bar", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, percentVariant: "number" },
      });

      expect(lines).toMatchSnapshot();
      expect(lines.join("\n")).toContain("34% left");
      expect(lines.join("\n")).not.toContain("█");
    });

    it("bar renders a bar with the number", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, percentVariant: "bar" },
      });

      expect(lines).toMatchSnapshot();
      expect(lines.join("\n")).toContain("█");
      expect(lines.join("\n")).toContain("34% left");
    });

    it("both renders a bar with the number", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, percentVariant: "both" },
      });

      expect(lines).toMatchSnapshot();
      expect(lines.join("\n")).toContain("█");
      expect(lines.join("\n")).toContain("34% left");
    });
  });

  describe("colorVariant", () => {
    it("has no visible effect in the sidebar because ANSI color is stripped", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const none = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, colorVariant: "none" },
      });
      const auto = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, colorVariant: "auto" },
      });

      expect(none).toEqual(auto);
    });
  });

  describe("alignmentVariant", () => {
    it("only affects minimal textVariant", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const left = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, textVariant: "default", alignmentVariant: "left" },
      });
      const right = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, textVariant: "default", alignmentVariant: "right" },
      });

      expect(left).toEqual(right);
    });

    it("left aligns the name in minimal rows", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, textVariant: "minimal", alignmentVariant: "left" },
      });

      expect(lines).toMatchSnapshot();
      expect(lines[0]).toMatch(/^OpenAI/);
    });

    it("right aligns the name in minimal rows", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));

      const lines = buildSidebarStatusPanelLines({
        data: singleWindowData(),
        config: { ...baseConfig, textVariant: "minimal", alignmentVariant: "right" },
      });

      expect(lines).toMatchSnapshot();
      expect(lines[0]).toContain("OpenAI");
      expect(lines[0]).not.toMatch(/^OpenAI/);
    });
  });
});
