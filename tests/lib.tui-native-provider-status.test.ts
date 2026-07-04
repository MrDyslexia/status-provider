import { describe, expect, it, vi } from "vitest";

import { hasNativeProviderStatusClient } from "../src/lib/tui-native-provider-status.js";

describe("hasNativeProviderStatusClient", () => {
  it("detects supported experimental provider status shapes without invoking them", () => {
    const providerStatus = vi.fn();
    const provider_status = vi.fn();
    const status = vi.fn();

    expect(hasNativeProviderStatusClient({ experimental: { providerStatus } })).toBe(true);
    expect(hasNativeProviderStatusClient({ experimental: { provider_status } })).toBe(true);
    expect(hasNativeProviderStatusClient({ experimental: { provider: { status } } })).toBe(true);

    expect(providerStatus).not.toHaveBeenCalled();
    expect(provider_status).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("returns false for missing or unrelated client shapes", () => {
    expect(hasNativeProviderStatusClient(undefined)).toBe(false);
    expect(hasNativeProviderStatusClient(null)).toBe(false);
    expect(hasNativeProviderStatusClient({})).toBe(false);
    expect(hasNativeProviderStatusClient({ experimental: null })).toBe(false);
    expect(hasNativeProviderStatusClient({ experimental: { providerStatus: undefined } })).toBe(false);
    expect(hasNativeProviderStatusClient({ experimental: { provider_status: null } })).toBe(false);
    expect(hasNativeProviderStatusClient({ experimental: { provider: {} } })).toBe(false);
    expect(hasNativeProviderStatusClient({ experimental: { provider: { status: undefined } } })).toBe(false);
    expect(hasNativeProviderStatusClient({ providerStatus: vi.fn() })).toBe(false);
  });

  it("ignores falsey primitive feature-flag sentinels", () => {
    expect(hasNativeProviderStatusClient({ experimental: { providerStatus: false } })).toBe(false);
    expect(hasNativeProviderStatusClient({ experimental: { provider_status: 0 } })).toBe(false);
    expect(hasNativeProviderStatusClient({ experimental: { provider: { status: "" } } })).toBe(false);
  });
});
