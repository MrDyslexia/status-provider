function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isStatusApiLike(value: unknown): boolean {
  return Boolean(value) && (typeof value === "object" || typeof value === "function");
}

/**
 * Detect whether an OpenCode client advertises native provider-status support.
 *
 * This is intentionally a no-fetch duck-typing guard for slot-registration decisions.
 */
export function hasNativeProviderStatusClient(client: unknown): boolean {
  if (!isRecord(client)) return false;

  const experimental = client.experimental;
  if (!isRecord(experimental)) return false;

  if (isStatusApiLike(experimental.providerStatus)) return true;
  if (isStatusApiLike(experimental.provider_status)) return true;

  const provider = experimental.provider;
  return isRecord(provider) && isStatusApiLike(provider.status);
}
