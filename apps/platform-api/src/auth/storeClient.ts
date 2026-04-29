import { createLogger } from "@rezovo/logging";
import { query } from "../persistence/dbClient";
import { AuthUser } from "./types";

const logger = createLogger({ service: "platform-api", module: "authStore" });

export class AuthStoreClient {
  async findActiveOrgId(orgId: string): Promise<string | undefined> {
    const result = await query(
      "SELECT id FROM organizations WHERE id = $1 AND status = 'active' LIMIT 1",
      [orgId],
    );
    return result.rows[0]?.id as string | undefined;
  }

  async upsertOrgFromClerk(org: {
    orgId: string;
    name?: string;
    slug?: string;
    imageUrl?: string;
    membersCount?: number;
    publicMetadata?: Record<string, unknown>;
    privateMetadata?: Record<string, unknown>;
  }): Promise<void> {
    const displayName = org.name?.trim() || org.orgId;
    const metadata = {
      clerk: {
        slug: org.slug ?? null,
        image_url: org.imageUrl ?? null,
        members_count: org.membersCount ?? null,
      },
      public_metadata: org.publicMetadata ?? {},
      private_metadata: org.privateMetadata ?? {},
    };

    await query(
      `INSERT INTO organizations (
         id, name, business_id, business_name, metadata, status, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, 'active', now(), now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         business_id = COALESCE(NULLIF(organizations.business_id, ''), EXCLUDED.business_id),
         business_name = COALESCE(NULLIF(organizations.business_name, ''), EXCLUDED.business_name),
         metadata = COALESCE(organizations.metadata, '{}'::jsonb) || EXCLUDED.metadata,
         status = 'active',
         updated_at = now()`,
      [
        org.orgId,
        displayName,
        `business-${org.orgId}`,
        displayName,
        JSON.stringify(metadata),
      ],
    );
  }

  async findByClerkIdInOrg(clerkId: string, orgId: string): Promise<AuthUser | undefined> {
    const result = await query(
      "SELECT id, org_id, email, roles FROM users WHERE clerk_id = $1 AND org_id = $2 AND status = 'active' LIMIT 1",
      [clerkId, orgId],
    );
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0];
    return {
      userId: row.id,
      orgId: row.org_id,
      email: row.email,
      roles: row.roles ?? ["viewer"],
    };
  }

  async findByEmailInOrg(email: string, orgId: string): Promise<AuthUser | undefined> {
    const result = await query(
      "SELECT id, org_id, email, roles FROM users WHERE LOWER(email) = LOWER($1) AND org_id = $2 AND status = 'active' LIMIT 1",
      [email, orgId],
    );
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0];
    return {
      userId: row.id,
      orgId: row.org_id,
      email: row.email,
      roles: row.roles ?? ["viewer"],
    };
  }

  async listByClerkId(clerkId: string): Promise<AuthUser[]> {
    try {
      const result = await query(
        "SELECT id, org_id, email, roles FROM users WHERE clerk_id = $1 AND status = 'active'",
        [clerkId],
      );
      return result.rows.map((row: any) => ({
        userId: row.id,
        orgId: row.org_id,
        email: row.email,
        roles: row.roles ?? ["viewer"],
      }));
    } catch (err) {
      logger.warn("listByClerkId failed", { error: (err as Error).message, clerkId });
      return [];
    }
  }

  async listByEmail(email: string): Promise<AuthUser[]> {
    try {
      const result = await query(
        "SELECT id, org_id, email, roles FROM users WHERE LOWER(email) = LOWER($1) AND status = 'active'",
        [email],
      );
      return result.rows.map((row: any) => ({
        userId: row.id,
        orgId: row.org_id,
        email: row.email,
        roles: row.roles ?? ["viewer"],
      }));
    } catch (err) {
      logger.warn("listByEmail failed", { error: (err as Error).message, email });
      return [];
    }
  }

  async listByOrg(orgId: string): Promise<AuthUser[]> {
    try {
      const result = await query(
        "SELECT id, org_id, email, roles FROM users WHERE org_id = $1 AND status = 'active'",
        [orgId],
      );
      return result.rows.map((row: any) => ({
        userId: row.id,
        orgId: row.org_id,
        email: row.email,
        roles: row.roles ?? ["viewer"],
      }));
    } catch (err) {
      logger.warn("listByOrg failed", { error: (err as Error).message, orgId });
      return [];
    }
  }

  async upsertUser(user: {
    id: string;
    orgId: string;
    email: string;
    roles?: string[];
    clerkId?: string;
    name?: string;
  }): Promise<void> {
    try {
      await query(
        `INSERT INTO users (id, org_id, email, roles, clerk_id, name, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', now())
         ON CONFLICT (org_id, email) DO UPDATE SET
           roles = COALESCE(EXCLUDED.roles, users.roles),
           clerk_id = COALESCE(EXCLUDED.clerk_id, users.clerk_id),
           name = COALESCE(EXCLUDED.name, users.name),
           updated_at = now()`,
        [
          user.id,
          user.orgId,
          user.email,
          user.roles ?? ["viewer"],
          user.clerkId ?? null,
          user.name ?? null,
        ],
      );
    } catch (err) {
      logger.warn("upsertUser failed", {
        error: (err as Error).message,
        orgId: user.orgId,
        email: user.email,
      });
    }
  }
}
