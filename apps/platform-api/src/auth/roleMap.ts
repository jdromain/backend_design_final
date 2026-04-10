import type { AuthRole } from "./types";

export function mapClerkOrgRoleToAppRoles(clerkRoleRaw: unknown): AuthRole[] {
  const clerkRole = typeof clerkRoleRaw === "string" ? clerkRoleRaw.toLowerCase() : "";
  if (clerkRole.includes("owner") || clerkRole.includes("admin")) {
    return ["admin"];
  }
  if (clerkRole.includes("manager") || clerkRole.includes("editor")) {
    return ["editor"];
  }
  return ["viewer"];
}
