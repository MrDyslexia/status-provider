import type { StatusProviderContext } from "./entries.js";
import {
  getStatusProviderRuntimeIds,
  type CanonicalStatusProviderId,
} from "./provider-metadata.js";

export async function isAnyProviderIdAvailable(params: {
  ctx: Pick<StatusProviderContext, "client">;
  candidateIds: readonly string[];
  fallbackOnError: boolean;
}): Promise<boolean> {
  const { ctx, candidateIds, fallbackOnError } = params;

  try {
    const resp = await ctx.client.config.providers();
    const ids = new Set((resp.data?.providers ?? []).map((p) => p.id));
    return candidateIds.some((id) => ids.has(id));
  } catch {
    return fallbackOnError;
  }
}

export async function isCanonicalProviderAvailable(params: {
  ctx: Pick<StatusProviderContext, "client">;
  providerId: CanonicalStatusProviderId;
  fallbackOnError: boolean;
}): Promise<boolean> {
  const { ctx, providerId, fallbackOnError } = params;
  return isAnyProviderIdAvailable({
    ctx,
    candidateIds: getStatusProviderRuntimeIds(providerId),
    fallbackOnError,
  });
}
