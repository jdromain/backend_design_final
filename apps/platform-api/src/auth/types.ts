export type AuthRole = "admin" | "editor" | "viewer";

export type AuthUser = {
  userId: string;
  tenantId: string;
  email: string;
  roles: AuthRole[];
};









