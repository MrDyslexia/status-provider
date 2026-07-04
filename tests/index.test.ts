import { beforeEach, describe, expect, it, vi } from "vitest";

const pluginMocks = vi.hoisted(() => ({
  StatusProviderPlugin: vi.fn(),
}));

vi.mock("../src/plugin.js", () => ({
  StatusProviderPlugin: pluginMocks.StatusProviderPlugin,
}));

describe("package entrypoint", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("exports the V1 plugin module shape on the default export", async () => {
    const mod = await import("../src/index.js");

    expect(mod.default).toEqual({
      id: "status-provider",
      server: pluginMocks.StatusProviderPlugin,
    });
    expect(mod.StatusProviderPlugin).toBe(pluginMocks.StatusProviderPlugin);
  });
});
