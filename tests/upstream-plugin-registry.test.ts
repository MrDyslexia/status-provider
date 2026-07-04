import { describe, expect, it } from "vitest";

import { normalizeLatestPublishedPluginVersion } from "../scripts/lib/upstream-plugin-registry.mjs";
import { getUpstreamPluginSpec } from "../scripts/lib/upstream-plugin-specs.mjs";

describe("upstream-plugin-registry", () => {
  it("builds canonical npm metadata for the scoped Cursor package", () => {
    const spec = getUpstreamPluginSpec("opencode-cursor-oauth");
    expect(spec).toBeTruthy();
    if (!spec) return;

    const latest = normalizeLatestPublishedPluginVersion(spec, {
      "dist-tags": {
        latest: "0.4.3",
      },
      repository: {
        type: "git",
        url: "git+https://github.com/PoolPirate/opencode-cursor.git",
      },
      time: {
        "0.4.3": "2026-04-08T14:04:58.057Z",
      },
      versions: {
        "0.4.3": {
          dist: {
            tarball: "https://example.test/@playwo/opencode-cursor-oauth/-/opencode-cursor-oauth-0.4.3.tgz",
          },
          repository: {
            type: "git",
            url: "git+https://github.com/PoolPirate/opencode-cursor.git",
          },
        },
      },
    });

    expect(latest.packageName).toBe("@playwo/opencode-cursor-oauth");
    expect(latest.repo).toBe("PoolPirate/opencode-cursor");
    expect(latest.npmUrl).toBe(
      "https://www.npmjs.com/package/%40playwo/opencode-cursor-oauth/v/0.4.3",
    );
  });
});
