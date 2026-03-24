import { FastifyReply, FastifyRequest } from "fastify";

import { AnalyticsStore } from "./store";
import { PersistenceStore } from "../persistence/store";

const persistence = new PersistenceStore();

export function analyticsRoutes(store: AnalyticsStore) {
  return {
    calls: async (request: FastifyRequest<{ Querystring: { tenantId: string } }>, reply: FastifyReply) => {
      const { tenantId } = request.query ?? {};
      if (!tenantId) {
        reply.status(400);
        return { error: "tenantId required" };
      }
      return store.getCallSummary(tenantId);
    },
    tools: async (request: FastifyRequest<{ Querystring: { tenantId: string } }>, reply: FastifyReply) => {
      const { tenantId } = request.query ?? {};
      if (!tenantId) {
        reply.status(400);
        return { error: "tenantId required" };
      }
      return store.getToolSummary(tenantId);
    }
  };
}

