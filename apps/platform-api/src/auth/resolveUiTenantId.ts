import type { FastifyRequest } from "fastify";

import { env } from "../env";
import { isClerkEnabled } from "./clerk";

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
  | { ok: false; reason: "missing_auth_tenant" | "tenant_mismatch" };

/**
 * Tenant for dashboard / UI-scoped routes.
 *
 * **Clerk mode (`CLERK_AUTH_ENABLED`):** only `request.auth.tenant_id` (from DB user).
 * Query `tenantId` is ignored for selection; if present and differs from auth tenant → `tenant_mismatch` (403).
 *
 * **Dev JWT mode:** non-production (or `ALLOW_DEV_TENANT_QUERY_OVERRIDE`): query may override, then auth, then default.
 * Production dev-JWT: auth tenant only (no query override).
 */
export function resolveUiTenantId(
  request: FastifyRequest,
  queryTenantIdRaw: unknown
): ResolveUiTenantResult {
  const queryTenantId = normalizeTenantId(queryTenantIdRaw);
  const authTenant = normalizeTenantId(request.auth?.tenant_id);

  if (isClerkEnabled) {
    if (!authTenant) {
      return { ok: false, reason: "missing_auth_tenant" };
    }
    if (queryTenantId && queryTenantId !== authTenant) {
      return { ok: false, reason: "tenant_mismatch" };
    }
    return { ok: true, tenantId: authTenant };
  }

  if (devTenantPrecedence()) {
    const fallback = normalizeTenantId(env.CLERK_DEFAULT_TENANT_ID) ?? "test-tenant";
    return { ok: true, tenantId: queryTenantId ?? authTenant ?? fallback };
  }

  if (!authTenant) {
    return { ok: false, reason: "missing_auth_tenant" };
  }

  if (queryTenantId && queryTenantId !== authTenant) {
    return { ok: false, reason: "tenant_mismatch" };
  }

  return { ok: true, tenantId: authTenant };
}
