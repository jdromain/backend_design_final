import type { FastifyReply, FastifyRequest } from "fastify";

import { sendError } from "../lib/responses";
import { resolveUiOrgId } from "./resolveUiOrgId";

/**
 * Resolves org id for org-scoped reads/writes. Sends error response and returns null on failure.
 */
export function requireOrgForRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  queryOrgIdRaw: unknown,
): string | null {
  const result = resolveUiOrgId(request, queryOrgIdRaw);
  if (result.ok) return result.orgId;

  if (result.reason === "missing_auth_org") {
    sendError(reply, 401, "missing_auth_org", "Authentication required for org-scoped resource");
    return null;
  }

  sendError(reply, 403, "org_mismatch", "orgId query does not match authenticated organization");
  return null;
}
