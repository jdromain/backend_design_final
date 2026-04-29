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

function assertSessionOrgConsistency(
  session: VerifiedClerkSession,
  user: AuthUser,
): "missing_org" | "org_mismatch" | null {
  // Fallback mode: when token has no org claim, allow scoped user resolution
  // from local membership lookup (single-org user or explicit query org).
  if (!session.orgId) {
    return null;
  }

  if (session.orgId !== user.orgId) {
    return "org_mismatch";
  }

  return null;
}

async function resolveClerkUser(
  session: VerifiedClerkSession,
  request: FastifyRequest,
): Promise<AuthUser | undefined> {
  const queryOrgRaw = (request.query as { orgId?: unknown } | undefined)?.orgId;
  const queryOrgId = typeof queryOrgRaw === "string" && queryOrgRaw.trim().length > 0
    ? queryOrgRaw.trim()
    : undefined;

  if (!session.orgId) {
    if (queryOrgId) {
      const inQueryOrg =
        (await authStore.findByClerkIdInOrg(session.sub, queryOrgId)) ??
        (await authStore.findByEmailInOrg(session.email, queryOrgId));
      if (inQueryOrg) {
        return inQueryOrg;
      }
    }

    const byClerk = await authStore.listByClerkId(session.sub);
    if (byClerk.length === 1) {
      return byClerk[0];
    }
    if (byClerk.length > 1) {
      return undefined;
    }

    const byEmail = await authStore.listByEmail(session.email);
    if (byEmail.length === 1) {
      return byEmail[0];
    }
    return undefined;
  }

  let user = await authStore.findByClerkIdInOrg(session.sub, session.orgId);
  if (!user) {
    user = await authStore.findByEmailInOrg(session.email, session.orgId);
  }
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
      const user = await resolveClerkUser(session, request);
      if (!user) {
        sendError(
          reply,
          403,
          "org_not_provisioned",
          "No Rezovo user membership exists for this account/org context.",
        );
        return;
      }

      const mismatch = assertSessionOrgConsistency(session, user);
      if (mismatch === "missing_org") {
        sendError(
          reply,
          403,
          "missing_org",
          "Active Clerk organization is required. Switch to an organization in Clerk.",
        );
        return;
      }
      if (mismatch === "org_mismatch") {
        sendError(
          reply,
          403,
          "org_membership_required",
          "Active Clerk organization is not linked to this Rezovo user membership.",
        );
        return;
      }

      request.auth = {
        sub: user.userId,
        org_id: user.orgId,
        email: user.email,
        roles: user.roles,
      };

      if (allowedRoles && allowedRoles.length > 0) {
        const roles = request.auth.roles;
        const ok = allowedRoles.some((role) => roles.includes(role));
        if (!ok) {
          reply.status(403).send({ error: "forbidden" });
          return;
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
