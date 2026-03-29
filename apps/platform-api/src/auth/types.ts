import "fastify";

export type AuthRole = "admin" | "editor" | "viewer";

export type AuthUser = {
  userId: string;
  tenantId: string;
  email: string;
  roles: AuthRole[];
};

export interface RequestAuth {
  sub: string;
  tenant_id: string;
  email: string;
  roles: AuthRole[];
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by auth hooks when a valid Bearer token is present. */
    auth?: RequestAuth;
  }
}
