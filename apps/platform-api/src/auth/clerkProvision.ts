import { createLogger } from "@rezovo/logging";
import { env } from "../env";
import type { AuthUser } from "./types";
import type { VerifiedClerkSession } from "./clerk";
import { getClerkBackendClient } from "./clerk";
import { AuthStoreClient } from "./storeClient";
import { mapClerkOrgRoleToAppRoles } from "./roleMap";

const logger = createLogger({ service: "platform-api", module: "clerkProvision" });
const store = new AuthStoreClient();

/**
 * First-request fallback when webhook has not created the user yet.
 * Resolves the active Clerk organization for the user and upserts a local org membership.
 */
export async function tryProvisionUserFromClerkSession(
  session: VerifiedClerkSession
): Promise<AuthUser | undefined> {
  if (!env.CLERK_BOOTSTRAP_ON_AUTH) return undefined;

  const clerk = getClerkBackendClient();
  let email = session.email;
  if (email.endsWith("@clerk.placeholder")) {
    try {
      const u = await clerk.users.getUser(session.sub);
      const primary = u.emailAddresses?.find((e: { id: string }) => e.id === u.primaryEmailAddressId) ?? u.emailAddresses?.[0];
      email = primary?.emailAddress ?? email;
    } catch (e) {
      logger.warn("bootstrap: could not load Clerk user for email", { error: (e as Error).message });
    }
  }

  let orgId: string | undefined;
  let membershipRole: unknown;
  if (session.orgId) {
    orgId = await store.findActiveOrgId(session.orgId);
  }

  if (!orgId) {
    try {
      const list = await clerk.users.getOrganizationMembershipList({ userId: session.sub, limit: 20 });
      for (const m of list.data ?? []) {
        const oid = m.organization?.id;
        if (!oid) continue;
        const mappedOrgId = await store.findActiveOrgId(oid);
        if (mappedOrgId) {
          orgId = mappedOrgId;
          membershipRole = (m as any).role ?? (m as any).organizationMembership?.role;
          break;
        }
      }
    } catch (e) {
      logger.warn("bootstrap: org membership list failed", { error: (e as Error).message });
    }
  }

  if (!orgId) {
    logger.info("bootstrap: no organization mapped for Clerk user", { sub: session.sub, orgId: session.orgId });
    return undefined;
  }

  await store.upsertUser({
    id: `clerk-${session.sub}`,
    orgId,
    email,
    clerkId: session.sub,
    roles: mapClerkOrgRoleToAppRoles(membershipRole),
  });

  return store.findByClerkIdInOrg(session.sub, orgId);
}
