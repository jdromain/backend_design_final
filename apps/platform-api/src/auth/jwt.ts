import { FastifyReply, FastifyRequest } from "fastify";

import { createLogger } from "@rezovo/logging";
import { env } from "../env";
import { sendError } from "../lib/responses";

import { AuthRole, AuthUser } from "./types";
import { verifyClerkToken, type VerifiedClerkSession } from "./clerk";
import { AuthStoreClient } from "./storeClient";
import { tryProvisionUserFromClerkSession } from "./clerkProvision";

const logger = createLogger({ service: "platform-api", module: "auth" });
const authStore = new AuthStoreClient();

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

function isInternalServiceToken(token: string | null): boolean {
  if (!token) return false;
  return Boolean(env.INTERNAL_SERVICE_TOKEN) && token === env.INTERNAL_SERVICE_TOKEN;
}

async function assertSessionTenantConsistency(
  session: VerifiedClerkSession,
  user: AuthUser,
): Promise<"tenant_claim_mismatch" | "org_tenant_mismatch" | null> {
  if (session.tenantIdClaim && session.tenantIdClaim !== user.tenantId) {
    return "tenant_claim_mismatch";
  }
  if (session.orgId) {
    const mappedTenant = await authStore.findTenantIdByClerkOrganizationId(session.orgId);
    if (mappedTenant && mappedTenant !== user.tenantId) {
      return "org_tenant_mismatch";
    }
  }
  return null;
}

async function resolveClerkUser(session: VerifiedClerkSession): Promise<AuthUser | undefined> {
  let user =
    (await authStore.findByClerkId(session.sub)) ??
    (await authStore.findByEmail(session.email));
  if (!user) {
    user = (await tryProvisionUserFromClerkSession(session)) ?? undefined;
  }
  return user;
}

export function authHook(allowedRoles?: AuthRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = extractBearerToken(request);
    if (!token) {
      reply.status(401).send({ error: "unauthorized" });
      return;
    }

    try {
      const session = await verifyClerkToken(token);
      const user = await resolveClerkUser(session);
      if (!user) {
        sendError(
          reply,
          403,
          "not_provisioned",
          "No Rezovo user for this Clerk account. Use a Clerk org linked to a tenant (public_metadata.tenant_id), accept an invite, or wait for webhook sync.",
        );
        return;
      }

      const mismatch = await assertSessionTenantConsistency(session, user);
      if (mismatch === "tenant_claim_mismatch") {
        sendError(
          reply,
          403,
          "tenant_claim_mismatch",
          "JWT tenant_id claim does not match your Rezovo user.",
        );
        return;
      }
      if (mismatch === "org_tenant_mismatch") {
        sendError(
          reply,
          403,
          "org_tenant_mismatch",
          "Active Clerk organization is not mapped to your Rezovo tenant.",
        );
        return;
      }

      request.auth = {
        sub: user.userId,
        tenant_id: user.tenantId,
        email: user.email,
        roles: user.roles,
      };

      if (allowedRoles && allowedRoles.length > 0) {
        const roles = request.auth.roles;
        const ok = allowedRoles.some((role) => roles.includes(role));
        if (!ok) {
          reply.status(403).send({ error: "forbidden" });
        }
      }
    } catch (error) {
      logger.warn("auth verification failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      reply.status(401).send({ error: "unauthorized" });
    }
  };
}

export function authOrInternalHook(allowedRoles?: AuthRole[]) {
  const userAuth = authHook(allowedRoles);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = extractBearerToken(request);
    if (isInternalServiceToken(token)) {
      request.internalServiceAuth = true;
      return;
    }
    await userAuth(request, reply);
  };
}

export function resolvedAuthHook(roles?: AuthRole[]) {
  return authHook(roles);
}

export function resolvedAuthOrInternalHook(roles?: AuthRole[]) {
  return authOrInternalHook(roles);
}
