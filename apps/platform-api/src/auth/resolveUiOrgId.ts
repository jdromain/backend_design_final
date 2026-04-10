import type { FastifyRequest } from "fastify";

function normalizeOrgId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const orgId = raw.trim();
  return orgId.length > 0 ? orgId : undefined;
}

export type ResolveUiOrgResult =
  | { ok: true; orgId: string }
  | { ok: false; reason: "missing_auth_org" | "org_mismatch" };

/**
 * Organization for dashboard / UI-scoped routes.
 * Clerk-first: the authenticated user's organization is authoritative.
 * Query `orgId` may be provided for consistency checks only.
 */
export function resolveUiOrgId(
  request: FastifyRequest,
  queryOrgIdRaw: unknown,
): ResolveUiOrgResult {
  const authOrg = normalizeOrgId(request.auth?.org_id);
  const queryOrg = normalizeOrgId(queryOrgIdRaw);

  if (!authOrg) {
    return { ok: false, reason: "missing_auth_org" };
  }

  if (queryOrg && queryOrg !== authOrg) {
    return { ok: false, reason: "org_mismatch" };
  }

  return { ok: true, orgId: authOrg };
}
