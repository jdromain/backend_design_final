import { createClerkClient, verifyToken as verifyClerkJwt } from "@clerk/backend";
import { createLogger } from "@rezovo/logging";
import { env } from "../env";

const logger = createLogger({ service: "platform-api", module: "clerk" });

export const isClerkEnabled = env.CLERK_AUTH_ENABLED;

let clerkClient: ReturnType<typeof createClerkClient> | null = null;

function getClerk() {
  if (!clerkClient) {
    clerkClient = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  }
  return clerkClient;
}

export interface VerifiedClerkSession {
  sub: string;
  email: string;
  orgId?: string;
  /** Custom JWT claim; used only for consistency check against DB tenant */
  tenantIdClaim?: string;
}

function pickEmail(payload: Record<string, unknown>): string {
  const email =
    (payload.email as string | undefined) ??
    (payload.email_address as string | undefined) ??
    (payload.primary_email_address as string | undefined);
  if (email && typeof email === "string") return email;
  return `${payload.sub}@clerk.placeholder`;
}

function pickOrgId(payload: Record<string, unknown>): string | undefined {
  const o = payload.org_id ?? payload.organization_id ?? (payload.o as Record<string, unknown> | undefined)?.id;
  if (typeof o === "string" && o.length > 0) return o;
  return undefined;
}

function pickTenantIdClaim(payload: Record<string, unknown>): string | undefined {
  const t = payload.tenant_id;
  if (typeof t === "string" && t.trim().length > 0) return t.trim();
  return undefined;
}

function assertAudienceIssuer(payload: Record<string, unknown>): void {
  const aud = env.CLERK_JWT_AUDIENCE?.trim();
  if (aud) {
    const tokenAud = (payload.aud as string | undefined) ?? (payload.azp as string | undefined);
    if (tokenAud !== aud) {
      throw new Error(`JWT audience/azp mismatch: expected ${aud}, got ${tokenAud ?? "(missing)"}`);
    }
  }
  const iss = env.CLERK_JWT_ISSUER?.trim();
  if (iss) {
    const tokenIss = payload.iss as string | undefined;
    if (tokenIss !== iss) {
      throw new Error(`JWT issuer mismatch: expected ${iss}, got ${tokenIss ?? "(missing)"}`);
    }
  }
}

export async function verifyClerkToken(token: string): Promise<VerifiedClerkSession> {
  try {
    const payload = (await verifyClerkJwt(token, {
      secretKey: env.CLERK_SECRET_KEY || undefined,
      jwtKey: env.CLERK_JWT_PUBLIC_KEY || undefined,
      audience: env.CLERK_JWT_AUDIENCE || undefined,
    })) as unknown as Record<string, unknown>;

    assertAudienceIssuer(payload);

    const sub = payload.sub as string | undefined;
    if (!sub) {
      throw new Error("Clerk JWT missing sub");
    }

    return {
      sub,
      email: pickEmail({ ...payload, sub }),
      orgId: pickOrgId(payload),
      tenantIdClaim: pickTenantIdClaim(payload),
    };
  } catch (err) {
    logger.warn("clerk token verification failed", {
      error: (err as Error).message,
    });
    throw err;
  }
}

/** Clerk server SDK for webhooks / bootstrap. Return type is intentionally `any` for composite .d.ts emit. */
export function getClerkBackendClient(): any {
  return getClerk();
}
