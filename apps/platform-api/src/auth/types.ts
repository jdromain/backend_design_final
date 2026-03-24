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
    auth: RequestAuth;
  }
}
