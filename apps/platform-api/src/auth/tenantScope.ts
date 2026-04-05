import type { FastifyReply, FastifyRequest } from "fastify";

import { sendError } from "../lib/responses";
import { resolveUiTenantId } from "./resolveUiTenantId";

/**
 * Resolves tenant for tenant-scoped reads/writes. Sends error response and returns null on failure.
 */
export function requireTenantForRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  queryTenantIdRaw: unknown
): string | null {
  const r = resolveUiTenantId(request, queryTenantIdRaw);
  if (r.ok) return r.tenantId;

  if (r.reason === "missing_auth_tenant") {
    sendError(reply, 401, "missing_auth_tenant", "Authentication required for tenant-scoped resource");
    return null;
  }

  sendError(reply, 403, "tenant_mismatch", "tenantId query does not match authenticated tenant");
  return null;
}
