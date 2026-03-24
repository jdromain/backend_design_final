import jwt from "jsonwebtoken";
import { FastifyReply, FastifyRequest } from "fastify";

import { createLogger } from "@rezovo/logging";
import { env } from "../env";

import { AuthRole, AuthUser } from "./types";
import { findUserByEmail } from "./store";

const logger = createLogger({ service: "platform-api", module: "auth" });
const JWT_SECRET = env.JWT_SECRET;

export function issueToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.userId,
      tenant_id: user.tenantId,
      email: user.email,
      roles: user.roles
    },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

export async function loginHandler(
  request: FastifyRequest<{ Body: { email: string } }>,
  reply: FastifyReply
): Promise<unknown> {
  const { email } = request.body ?? {};
  if (!email) {
    reply.status(400);
    return { ok: false, error: "email required" };
  }
  const user = await findUserByEmail(email);
  if (!user) {
    reply.status(401);
    return { ok: false, error: "invalid credentials" };
  }
  const token = issueToken(user);
  return { ok: true, token };
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
      const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
      (request as any).auth = decoded;
      if (allowedRoles && allowedRoles.length > 0) {
        const roles: string[] = Array.isArray(decoded.roles) ? decoded.roles : [];
        const ok = allowedRoles.some((r) => roles.includes(r));
        if (!ok) {
          reply.status(403).send({ error: "forbidden" });
        }
      }
    } catch (err) {
      logger.warn("jwt verify failed", { error: (err as Error).message });
      reply.status(401).send({ error: "unauthorized" });
    }
  };
}



