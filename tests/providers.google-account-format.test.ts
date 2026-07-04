import { describe, expect, it } from "vitest";

import {
  formatGoogleAccountErrors,
  formatGoogleAccountLabel,
} from "../src/providers/google-account-format.js";

describe("google account formatting helpers", () => {
  it("formats fixed gmail hint labels for antigravity", () => {
    expect(formatGoogleAccountLabel("alice@example.com", "fixedGmailHint")).toBe("ali..gmail");
  });

  it("formats domain hint labels for gemini cli", () => {
    expect(formatGoogleAccountLabel("alice@example.com", "domainHint")).toBe("ali..example");
  });

  it("returns Unknown for missing or empty email", () => {
    expect(formatGoogleAccountLabel(undefined, "fixedGmailHint")).toBe("Unknown");
    expect(formatGoogleAccountLabel("", "domainHint")).toBe("Unknown");
  });

  it("maps account errors with preserved messages and style-specific labels", () => {
    const errors = [{ email: "bob@example.com", error: "Unauthorized" }];
    expect(formatGoogleAccountErrors(errors, "fixedGmailHint")).toEqual([
      { label: "bob..gmail", message: "Unauthorized" },
    ]);
    expect(formatGoogleAccountErrors(errors, "domainHint")).toEqual([
      { label: "bob..example", message: "Unauthorized" },
    ]);
  });
});
