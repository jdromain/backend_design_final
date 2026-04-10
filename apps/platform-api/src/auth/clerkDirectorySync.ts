import { createLogger } from "@rezovo/logging";
import { env } from "../env";
import { getClerkBackendClient } from "./clerk";
import { mapClerkOrgRoleToAppRoles } from "./roleMap";
import { AuthStoreClient } from "./storeClient";

const logger = createLogger({ service: "platform-api", module: "clerkDirectorySync" });
const store = new AuthStoreClient();

function extractEmailFromMembership(membership: any): string | undefined {
  const data = membership?.publicUserData ?? membership?.public_user_data;
  const email = data?.identifier ?? data?.emailAddress;
  if (typeof email === "string" && email.includes("@")) return email;
  return undefined;
}

function extractUserIdFromMembership(membership: any): string | undefined {
  const data = membership?.publicUserData ?? membership?.public_user_data;
  const userId = data?.userId ?? data?.user_id;
  if (typeof userId === "string" && userId.length > 0) return userId;
  return undefined;
}

function extractOrgItems(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export async function runClerkDirectorySyncOnStartup(): Promise<void> {
  if (!env.CLERK_AUTH_ENABLED || !env.CLERK_SECRET_KEY) {
    return;
  }

  const clerk = getClerkBackendClient();

  try {
    const organizationPayload = await clerk.organizations.getOrganizationList({ limit: 100 });
    const organizations = extractOrgItems(organizationPayload);

    for (const org of organizations) {
      const orgId = org.id as string | undefined;
      if (!orgId) continue;

      await store.upsertOrgFromClerk({
        orgId,
        name: org.name as string | undefined,
        slug: org.slug as string | undefined,
        imageUrl: org.imageUrl as string | undefined,
        membersCount: org.membersCount as number | undefined,
        publicMetadata: (org.publicMetadata as Record<string, unknown> | undefined) ?? {},
        privateMetadata: (org.privateMetadata as Record<string, unknown> | undefined) ?? {},
      });

      const membershipsPayload = await clerk.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        limit: 100,
      });
      const memberships = extractOrgItems(membershipsPayload);

      for (const membership of memberships) {
        const clerkUserId = extractUserIdFromMembership(membership);
        if (!clerkUserId) continue;

        let email = extractEmailFromMembership(membership) ?? "";
        let name: string | undefined;
        if (!email) {
          const user = await clerk.users.getUser(clerkUserId);
          const primary = user.emailAddresses?.find((entry: { id: string }) => entry.id === user.primaryEmailAddressId) ?? user.emailAddresses?.[0];
          email = primary?.emailAddress ?? "";
          name = [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;
        }

        if (!email) continue;

        await store.upsertUser({
          id: `clerk-${clerkUserId}-${orgId}`,
          orgId,
          email,
          clerkId: clerkUserId,
          name,
          roles: mapClerkOrgRoleToAppRoles(membership.role),
        });
      }
    }

    logger.info("startup Clerk directory sync complete", { orgCount: organizations.length });
  } catch (error) {
    logger.warn("startup Clerk directory sync failed", {
      error: (error as Error).message,
    });
  }
}
