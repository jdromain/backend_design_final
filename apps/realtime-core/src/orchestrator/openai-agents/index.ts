import { createLogger } from "@rezovo/logging";
import { retrieveKb } from "../../kbClient";

const logger = createLogger({ service: "realtime-core", module: "openai-agents" });

export async function fetchKbPassages(
  callId: string,
  query: string,
  orgId: string,
  businessId: string,
  namespace: string,
): Promise<string[]> {
  try {
    const result = await retrieveKb({
      org_id: orgId,
      business_id: businessId,
      namespace,
      query,
      topK: 3,
    });
    if (result.passages.length > 0) {
      logger.debug("KB passages fetched", { callId, matchCount: result.passages.length });
      return result.passages.map((p) => p.text);
    }
  } catch (error) {
    logger.warn("KB fetch failed (non-fatal)", {
      callId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return [];
}

export type { TurnDiagnostics } from "./contracts";
