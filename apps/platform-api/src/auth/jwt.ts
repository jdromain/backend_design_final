import jwt from "jsonwebtoken";
import { FastifyReply, FastifyRequest } from "fastify";

import { createLogger } from "@rezovo/logging";
import { env } from "../env";
import { sendError } from "../lib/responses";

import { AuthRole, AuthUser } from "./types";
import { findUserByEmail } from "./store";
import { isClerkEnabled, verifyClerkToken, type VerifiedClerkSession } from "./clerk";
import { AuthStoreClient } from "./storeClient";
import { tryProvisionUserFromClerkSession } from "./clerkProvision";

const logger = createLogger({ service: "platform-api", module: "auth" });
const JWT_SECRET = env.JWT_SECRET;
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
  user: AuthUser
): Promise<"tenant_claim_mismatch" | "org_tenant_mismatch" | null> {
  if (session.tenantIdClaim && session.tenantIdClaim !== user.tenantId) {
    return "tenant_claim_mismatch";
  }
  if (session.orgId) {
    const tid = await authStore.findTenantIdByClerkOrganizationId(session.orgId);
    if (tid && tid !== user.tenantId) {
      return "org_tenant_mismatch";
    }
  }
  return null;
}

/**
 * Resolves DB user for a verified Clerk session (lookup + optional bootstrap).
 */
async function resolveClerkUser(session: VerifiedClerkSession): Promise<AuthUser | undefined> {
  let user =
    (await authStore.findByClerkId(session.sub)) ?? (await authStore.findByEmail(session.email));
  if (!user) {
    user = (await tryProvisionUserFromClerkSession(session)) ?? undefined;
  }
  return user;
}

export function issueToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.userId,
      tenant_id: user.tenantId,
      email: user.email,
      roles: user.roles,
    },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

const LOGIN_FAIL_HINT =
  "No active user with that email. Default seed is admin@example.com (see database/002_ui_tables.sql). " +
  "If you use docker-compose Postgres, run `docker compose up -d postgres` on a fresh volume, or re-apply that SQL to your DATABASE_URL.";

export async function loginHandler(
  request: FastifyRequest<{ Body: { email: string } }>,
  reply: FastifyReply
): Promise<unknown> {
  const { email } = request.body ?? {};
  if (!email) {
    reply.status(400);
    return { ok: false, error: "email required" };
  }
  let user: Awaited<ReturnType<typeof findUserByEmail>>;
  try {
    user = await findUserByEmail(email);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    logger.warn("login user lookup failed", { error: msg });
    reply.status(503);
    if (/relation ["']users["'] does not exist/i.test(msg)) {
      return {
        ok: false,
        error:
          "database not migrated — public.users is missing. Apply database/setup_complete.sql and database/002_ui_tables.sql.",
      };
    }
    return {
      ok: false,
      error: `database unavailable (${msg.slice(0, 120)})`,
    };
  }
  if (!user) {
    reply.status(401);
    return { ok: false, error: `invalid credentials — ${LOGIN_FAIL_HINT}` };
  }
  const token = issueToken(user);
  return {
    ok: true,
    token,
    user: {
      id: user.userId,
      email: user.email,
      roles: user.roles,
      tenantId: user.tenantId,
    },
  };
}

export function authHook(allowedRoles?: AuthRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = extractBearerToken(request);
    if (!token) {
      reply.status(401).send({ error: "unauthorized" });
      return;
    }

    try {
      if (isClerkEnabled) {
        const session = await verifyClerkToken(token);
        const user = await resolveClerkUser(session);
        if (!user) {
          sendError(
            reply,
            403,
            "not_provisioned",
            "No Rezovo user for this Clerk account. Use a Clerk org linked to a tenant (public_metadata.tenant_id), accept an invite, or wait for webhook sync."
          );
          return;
        }
        const bad = await assertSessionTenantConsistency(session, user);
        if (bad === "tenant_claim_mismatch") {
          sendError(
            reply,
            403,
            "tenant_claim_mismatch",
            "JWT tenant_id claim does not match your Rezovo user."
          );
          return;
        }
        if (bad === "org_tenant_mismatch") {
          sendError(
            reply,
            403,
            "org_tenant_mismatch",
            "Active Clerk organization is not mapped to your Rezovo tenant."
          );
          return;
        }

        request.auth = {
          sub: user.userId,
          tenant_id: user.tenantId,
          email: user.email,
          roles: user.roles,
        };
      } else {
        const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
        request.auth = {
          sub: decoded.sub as string,
          tenant_id: decoded.tenant_id as string,
          email: decoded.email as string,
          roles: (decoded.roles as AuthRole[]) ?? [],
        };
      }

      if (allowedRoles && allowedRoles.length > 0) {
        const roles = request.auth.roles;
        const ok = allowedRoles.some((r) => roles.includes(r));
        if (!ok) {
          reply.status(403).send({ error: "forbidden" });
        }
      }
    } catch (err) {
      logger.warn("auth verification failed", { error: (err as Error).message });
      reply.status(401).send({ error: "unauthorized" });
    }
  };
}

/**
 * Internal-service aware auth: accepts either a valid user Bearer token or the
 * configured INTERNAL_SERVICE_TOKEN.
 */
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

/**
 * Development: attach `request.auth` when Bearer is valid. Clerk mode uses the same resolution as authHook
 * (including bootstrap); tenant mismatch leaves auth unset.
 */
export function optionalAuthHook() {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (env.NODE_ENV === "production") return;

    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return;
    const token = header.slice("Bearer ".length);

    try {
      if (isClerkEnabled) {
        const session = await verifyClerkToken(token);
        const user = await resolveClerkUser(session);
        if (!user) return;
        const bad = await assertSessionTenantConsistency(session, user);
        if (bad) return;
        request.auth = {
          sub: user.userId,
          tenant_id: user.tenantId,
          email: user.email,
          roles: user.roles,
        };
      } else {
        const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
        request.auth = {
          sub: decoded.sub as string,
          tenant_id: decoded.tenant_id as string,
          email: decoded.email as string,
          roles: (decoded.roles as AuthRole[]) ?? [],
        };
      }
    } catch {
      /* invalid / expired token — leave auth unset */
    }
  };
}

/**
 * Clerk-first policy: always enforce Bearer auth in all NODE_ENV values.
 * This keeps development behavior consistent with production and avoids accidental
 * unauthenticated access paths.
 */
export function resolvedAuthHook(roles?: AuthRole[]) {
  return authHook(roles);
}

/**
 * Clerk-first + internal service bridge for server-to-server routes.
 */
export function resolvedAuthOrInternalHook(roles?: AuthRole[]) {
  return authOrInternalHook(roles);
}

/**
 * Clerk mode only: verify Bearer and set `request.auth` in **all** NODE_ENV values.
 * Use on routes that must work with Clerk in production but are not wrapped in `authHook`
 * (e.g. legacy internal GETs). No-op when Clerk is disabled.
 */
export function attachClerkAuthIfBearerPresent() {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!isClerkEnabled) return;
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return;
    const token = header.slice("Bearer ".length);
    try {
      const session = await verifyClerkToken(token);
      const user = await resolveClerkUser(session);
      if (!user) return;
      const bad = await assertSessionTenantConsistency(session, user);
      if (bad) return;
      request.auth = {
        sub: user.userId,
        tenant_id: user.tenantId,
        email: user.email,
        roles: user.roles,
      };
    } catch {
      /* leave auth unset */
    }
  };
}
