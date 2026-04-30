import type { ConfigSnapshotResponse } from "./fetcher";
import { ConfigCache } from "./cache";
import { fetchConfigSnapshot } from "./fetcher";

/**
 * Fetches a fresh org snapshot and merges it into the cache (per-org+lob, does not evict other tenants).
 * Use for bootstrap and `ConfigChanged` subscribers.
 */
export async function refreshConfigCacheForOrg(
  cache: ConfigCache,
  orgId: string,
  lob = "default",
): Promise<ConfigSnapshotResponse> {
  const snapshot = await fetchConfigSnapshot(orgId, lob);
  cache.replaceFromSnapshot(snapshot);
  return snapshot;
}
