import { createLogger } from "@rezovo/logging";
import { ConfigCache } from "../config-cache/cache";

const logger = createLogger({ service: "realtime-core", module: "telephony" });

export function createDidRouter(cache: ConfigCache) {
  return function resolveRoute(did: string, tenantId: string, lob?: string) {
    const config = cache.getRoute(did, tenantId, lob);
    if (!config) {
      logger.warn("no config for DID", { did, tenantId, lob });
      return { routeType: "voicemail" as const };
    }
    return config;
  };
}

