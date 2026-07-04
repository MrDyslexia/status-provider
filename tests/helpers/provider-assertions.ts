import { expect } from "vitest";

import type { StatusProviderResult } from "../../src/lib/entries.js";

export function expectNotAttempted(out: StatusProviderResult): void {
  expect(out.attempted).toBe(false);
  expect(out.entries).toEqual([]);
  expect(out.errors).toEqual([]);
}

export function expectAttemptedWithNoErrors(out: StatusProviderResult): void {
  expect(out.attempted).toBe(true);
  expect(out.errors).toEqual([]);
}

export function expectAttemptedWithErrorLabel(out: StatusProviderResult, label: string): void {
  expect(out.attempted).toBe(true);
  expect(out.entries).toEqual([]);
  expect(out.errors[0]?.label).toBe(label);
}
