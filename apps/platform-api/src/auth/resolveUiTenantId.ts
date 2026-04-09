import type { FastifyRequest } from "fastify";

function normalizeTenantId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const tenantId = raw.trim();
  return tenantId.length > 0 ? tenantId : undefined;
}

export type ResolveUiTenantResult =
  | { ok: true; tenantId: string }
  | { ok: false; reason: "missing_auth_tenant" | "tenant_mismatch" };

/**
 * Tenant for dashboard / UI-scoped routes.
 * Clerk-first: the authenticated user's tenant is always authoritative.
 * Query `tenantId` may be provided for consistency checks only.
 */
export function resolveUiTenantId(
  request: FastifyRequest,
  queryTenantIdRaw: unknown,
): ResolveUiTenantResult {
  const authTenant = normalizeTenantId(request.auth?.tenant_id);
  const queryTenant = normalizeTenantId(queryTenantIdRaw);

  if (!authTenant) {
    return { ok: false, reason: "missing_auth_tenant" };
  }

  if (queryTenant && queryTenant !== authTenant) {
    return { ok: false, reason: "tenant_mismatch" };
  }

  return { ok: true, tenantId: authTenant };
}
