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
  if (!session.orgId) {
    return "missing_org";
  }

  if (session.orgId !== user.orgId) {
    return "org_mismatch";
  }

  return null;
}

async function resolveClerkUser(session: VerifiedClerkSession): Promise<AuthUser | undefined> {
  if (!session.orgId) {
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
      const user = await resolveClerkUser(session);
      if (!user) {
        sendError(
          reply,
          403,
          "org_not_provisioned",
          "No Rezovo user membership exists for the active Clerk organization.",
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
