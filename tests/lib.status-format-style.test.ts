import { describe, expect, it } from "vitest";

import {
  getStatusFormatStyleDefinition,
  getStatusFormatStyleLabel,
  isStatusFormatStyle,
  resolveStatusFormatStyle,
} from "../src/lib/status-format-style.js";

describe("status format style helpers", () => {
  it("accepts canonical values and legacy aliases", () => {
    expect(isStatusFormatStyle("singleWindow")).toBe(true);
    expect(isStatusFormatStyle("allWindows")).toBe(true);
    expect(isStatusFormatStyle("classic")).toBe(true);
    expect(isStatusFormatStyle("grouped")).toBe(true);
    expect(isStatusFormatStyle("single_window_per_provider")).toBe(false);
    expect(isStatusFormatStyle("all_windows")).toBe(false);
    expect(isStatusFormatStyle("unknown")).toBe(false);
  });

  it("resolves aliases to canonical style ids", () => {
    expect(resolveStatusFormatStyle("singleWindow")).toBe("singleWindow");
    expect(resolveStatusFormatStyle("classic")).toBe("singleWindow");
    expect(resolveStatusFormatStyle("allWindows")).toBe("allWindows");
    expect(resolveStatusFormatStyle("grouped")).toBe("allWindows");
  });

  it("falls back to the canonical single-window default for invalid values", () => {
    expect(resolveStatusFormatStyle(undefined)).toBe("singleWindow");
    expect(resolveStatusFormatStyle("mystery")).toBe("singleWindow");
    expect(resolveStatusFormatStyle("single_window_per_provider")).toBe("singleWindow");
    expect(resolveStatusFormatStyle("all_windows")).toBe("singleWindow");
  });

  it("exposes labels and behavior mapping from the shared registry", () => {
    expect(getStatusFormatStyleLabel("classic")).toBe("Single window");
    expect(getStatusFormatStyleLabel("allWindows")).toBe("All windows");
    expect(getStatusFormatStyleDefinition("grouped")).toMatchObject({
      id: "allWindows",
      projection: "allWindows",
      renderer: "grouped",
      sessionTokens: "detailed",
    });
  });
});
