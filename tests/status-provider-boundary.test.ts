import { describe, expect, it } from "vitest";

import { listProviders as listModelsDevProviders } from "../src/lib/modelsdev-pricing.js";
import { STATUS_PROVIDER_SHAPES } from "../src/lib/provider-metadata.js";
import { getProviders } from "../src/providers/registry.js";

describe("status provider boundary", () => {
  it("keeps the runtime registry aligned with the canonical provider catalog", () => {
    const statusProviders = getProviders().map((p) => p.id);
    expect(statusProviders).toEqual(STATUS_PROVIDER_SHAPES.map((shape) => shape.id));
    expect(statusProviders).toContain("synthetic");
  });

  it("models.dev pricing providers include ids beyond status provider support", () => {
    const statusSet = new Set(getProviders().map((p) => p.id));
    const modelsDevProviders = listModelsDevProviders();
    const notInStatusRegistry = modelsDevProviders.filter((id) => !statusSet.has(id));
    expect(notInStatusRegistry.length).toBeGreaterThan(0);
  });
});
