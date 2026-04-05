import type { FastifyRequest } from "fastify";

import { env } from "../env";

function normalizeTenantId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}

function devTenantPrecedence(): boolean {
  return env.NODE_ENV !== "production" || env.ALLOW_DEV_TENANT_QUERY_OVERRIDE;
}

export type ResolveUiTenantResult =
  | { ok: true; tenantId: string }
  | { ok: false; reason: "missing_auth_tenant" };

/**
 * Tenant for dashboard/UI read routes.
 *
 * Non-production (or ALLOW_DEV_TENANT_QUERY_OVERRIDE): query `tenantId` wins,
 * then JWT/session tenant, then CLERK_DEFAULT_TENANT_ID (default test-tenant).
 *
 * Production: only the authenticated user's tenant; query cannot override.
 */
export function resolveUiTenantId(
  request: FastifyRequest,
  queryTenantIdRaw: unknown
): ResolveUiTenantResult {
  const queryTenantId = normalizeTenantId(queryTenantIdRaw);
  const authTenant = normalizeTenantId(request.auth?.tenant_id);

  if (devTenantPrecedence()) {
    const fallback = normalizeTenantId(env.CLERK_DEFAULT_TENANT_ID) ?? "test-tenant";
    return { ok: true, tenantId: queryTenantId ?? authTenant ?? fallback };
  }

  if (!authTenant) {
    return { ok: false, reason: "missing_auth_tenant" };
  }

  return { ok: true, tenantId: authTenant };
}
