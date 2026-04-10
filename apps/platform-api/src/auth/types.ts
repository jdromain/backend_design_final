import "fastify";

export type AuthRole = "admin" | "editor" | "viewer";

export type AuthUser = {
  userId: string;
  orgId: string;
  email: string;
  roles: AuthRole[];
};

export interface RequestAuth {
  sub: string;
  org_id: string;
  email: string;
  roles: AuthRole[];
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by auth hooks when a valid Bearer token is present. */
    auth?: RequestAuth;
    /** True when request authenticated via internal service token. */
    internalServiceAuth?: boolean;
  }
}
