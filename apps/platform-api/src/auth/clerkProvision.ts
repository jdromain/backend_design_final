import { createLogger } from "@rezovo/logging";
import { env } from "../env";
import type { AuthUser } from "./types";
import type { VerifiedClerkSession } from "./clerk";
import { getClerkBackendClient } from "./clerk";
import { AuthStoreClient } from "./storeClient";

const logger = createLogger({ service: "platform-api", module: "clerkProvision" });
const store = new AuthStoreClient();

/**
 * First-request fallback when webhook has not created the user yet.
 * Resolves tenant from active org id on the session, or first org membership with a mapped tenant.
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

  let tenantId: string | undefined;
  if (session.orgId) {
    tenantId = await store.findTenantIdByClerkOrganizationId(session.orgId);
  }

  if (!tenantId) {
    try {
      const list = await clerk.users.getOrganizationMembershipList({ userId: session.sub, limit: 20 });
      for (const m of list.data ?? []) {
        const oid = m.organization?.id;
        if (!oid) continue;
        const tid = await store.findTenantIdByClerkOrganizationId(oid);
        if (tid) {
          tenantId = tid;
          break;
        }
      }
    } catch (e) {
      logger.warn("bootstrap: org membership list failed", { error: (e as Error).message });
    }
  }

  if (!tenantId) {
    logger.info("bootstrap: no tenant mapped for Clerk user", { sub: session.sub, orgId: session.orgId });
    return undefined;
  }

  await store.upsertUser({
    id: `clerk-${session.sub}`,
    tenantId,
    email,
    clerkId: session.sub,
    roles: ["viewer"],
  });

  return store.findByClerkId(session.sub);
}
