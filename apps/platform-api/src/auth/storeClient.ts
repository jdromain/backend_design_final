import { createLogger } from "@rezovo/logging";
import { query } from "../persistence/dbClient";
import { AuthUser } from "./types";

const logger = createLogger({ service: "platform-api", module: "authStore" });

export class AuthStoreClient {
  async findActiveTenantId(tenantId: string): Promise<string | undefined> {
    const result = await query(
      "SELECT id FROM tenants WHERE id = $1 AND status = 'active' LIMIT 1",
      [tenantId]
    );
    return result.rows[0]?.id as string | undefined;
  }

  async upsertTenantFromClerkOrg(org: {
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
      `INSERT INTO tenants (
         id, name, business_id, business_name, clerk_organization_id, metadata, status, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $1, $5::jsonb, 'active', now(), now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         business_id = COALESCE(NULLIF(tenants.business_id, ''), EXCLUDED.business_id),
         business_name = COALESCE(NULLIF(tenants.business_name, ''), EXCLUDED.business_name),
         clerk_organization_id = EXCLUDED.clerk_organization_id,
         metadata = COALESCE(tenants.metadata, '{}'::jsonb) || EXCLUDED.metadata,
         status = 'active',
         updated_at = now()`,
      [
        org.orgId,
        displayName,
        `business-${org.orgId}`,
        displayName,
        JSON.stringify(metadata),
      ]
    );
  }

  async findByEmail(email: string): Promise<AuthUser | undefined> {
    const result = await query(
      "SELECT id, tenant_id, email, roles, name FROM users WHERE LOWER(email) = LOWER($1) AND status = 'active'",
      [email]
    );
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0];
    return {
      userId: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      roles: row.roles ?? ["viewer"],
    };
  }

  async findByClerkId(clerkId: string): Promise<AuthUser | undefined> {
    const result = await query(
      "SELECT id, tenant_id, email, roles, name FROM users WHERE clerk_id = $1 AND status = 'active'",
      [clerkId]
    );
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0];
    return {
      userId: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      roles: row.roles ?? ["viewer"],
    };
  }

  async listByTenant(tenantId: string): Promise<AuthUser[]> {
    try {
      const result = await query(
        "SELECT id, tenant_id, email, roles, name FROM users WHERE tenant_id = $1 AND status = 'active'",
        [tenantId]
      );
      return result.rows.map((row: any) => ({
        userId: row.id,
        tenantId: row.tenant_id,
        email: row.email,
        roles: row.roles ?? ["viewer"],
      }));
    } catch (err) {
      logger.warn("listByTenant failed", { error: (err as Error).message });
      return [];
    }
  }

  async upsertUser(user: {
    id: string;
    tenantId: string;
    email: string;
    roles?: string[];
    clerkId?: string;
    name?: string;
  }): Promise<void> {
    try {
      await query(
        `INSERT INTO users (id, tenant_id, email, roles, clerk_id, name, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', now())
         ON CONFLICT (email) DO UPDATE SET
           tenant_id = COALESCE(EXCLUDED.tenant_id, users.tenant_id),
           roles = COALESCE(EXCLUDED.roles, users.roles),
           clerk_id = COALESCE(EXCLUDED.clerk_id, users.clerk_id),
           name = COALESCE(EXCLUDED.name, users.name),
           updated_at = now()`,
        [
          user.id,
          user.tenantId,
          user.email,
          user.roles ?? ["viewer"],
          user.clerkId ?? null,
          user.name ?? null,
        ]
      );
    } catch (err) {
      logger.warn("upsertUser failed", { error: (err as Error).message });
    }
  }
}
