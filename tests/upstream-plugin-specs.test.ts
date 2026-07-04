import { describe, expect, it } from "vitest";

import { CURSOR_CANONICAL_PLUGIN_PACKAGE } from "../src/lib/cursor-detection.js";
import {
  getUpstreamPluginIssueTitle,
  getUpstreamPluginSpec,
  UPSTREAM_PLUGIN_REFERENCE_ROOT,
  UPSTREAM_PLUGIN_SPECS,
} from "../scripts/lib/upstream-plugin-specs.mjs";

describe("upstream-plugin-specs", () => {
  it("tracks the expected upstream plugin ids", () => {
    expect(UPSTREAM_PLUGIN_SPECS.map((spec) => spec.pluginId)).toEqual([
      "opencode-antigravity-auth",
      "opencode-cursor-oauth",
      "opencode-gemini-auth",
      "opencode-qwencode-auth",
    ]);
  });

  it("builds the expected check issue titles", () => {
    expect(getUpstreamPluginIssueTitle("opencode-cursor-oauth")).toBe(
      "[check] opencode-cursor-oauth had update",
    );
  });

  it("stores references under the shared upstream plugin root", () => {
    for (const spec of UPSTREAM_PLUGIN_SPECS) {
      expect(spec.referenceDir).toBe(`${UPSTREAM_PLUGIN_REFERENCE_ROOT}/${spec.pluginId}`);
    }
  });

  it("tracks the Gemini CLI auth companion package and repo", () => {
    expect(getUpstreamPluginSpec("opencode-gemini-auth")).toMatchObject({
      packageName: "opencode-gemini-auth",
      pluginId: "opencode-gemini-auth",
      referenceDir: `${UPSTREAM_PLUGIN_REFERENCE_ROOT}/opencode-gemini-auth`,
      repo: "jenslys/opencode-gemini-auth",
    });
  });

  it("keeps the cursor internal plugin id stable while pointing at the canonical package and repo", () => {
    expect(getUpstreamPluginSpec("opencode-cursor-oauth")).toMatchObject({
      packageName: "@playwo/opencode-cursor-oauth",
      pluginId: "opencode-cursor-oauth",
      referenceDir: `${UPSTREAM_PLUGIN_REFERENCE_ROOT}/opencode-cursor-oauth`,
      repo: "PoolPirate/opencode-cursor",
    });
  });

  it("keeps the runtime Cursor package name aligned with the upstream spec", () => {
    expect(getUpstreamPluginSpec("opencode-cursor-oauth")?.packageName).toBe(
      CURSOR_CANONICAL_PLUGIN_PACKAGE,
    );
  });
});
