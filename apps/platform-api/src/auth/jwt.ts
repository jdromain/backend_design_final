import jwt from "jsonwebtoken";
import { FastifyReply, FastifyRequest } from "fastify";

import { createLogger } from "@rezovo/logging";
import { env } from "../env";

import { AuthRole, AuthUser } from "./types";
import { findUserByEmail } from "./store";
import { isClerkEnabled, verifyClerkToken } from "./clerk";
import { AuthStoreClient } from "./storeClient";

const logger = createLogger({ service: "platform-api", module: "auth" });
const JWT_SECRET = env.JWT_SECRET;
const authStore = new AuthStoreClient();

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
  "No active user with that email. Default seed is admin@example.com (see supabase/002_ui_tables.sql). " +
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
          "database not migrated — public.users is missing. Apply supabase/setup_complete.sql and supabase/002_ui_tables.sql (docker-compose mounts them on first Postgres init).",
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
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      reply.status(401).send({ error: "unauthorized" });
      return;
    }
    const token = header.slice("Bearer ".length);

    try {
      if (isClerkEnabled) {
        const claims = await verifyClerkToken(token);
        const user =
          (await authStore.findByClerkId(claims.sub)) ??
          (await authStore.findByEmail(claims.email));

        if (!user) {
          reply.status(403).send({ error: "user not found in system" });
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
 * Development only: if `Authorization: Bearer …` is valid, attach `request.auth`
 * (tenant_id, roles, etc.). If missing or invalid, continue — routes may still use
 * `?tenantId=`. This matches production behavior after JWT dev-login without
 * requiring query params on every `lib/api-client` GET.
 */
export function optionalAuthHook() {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (env.NODE_ENV === "production") return;

    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return;
    const token = header.slice("Bearer ".length);

    try {
      if (isClerkEnabled) {
        const claims = await verifyClerkToken(token);
        const user =
          (await authStore.findByClerkId(claims.sub)) ??
          (await authStore.findByEmail(claims.email));
        if (!user) return;
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
