import { createClerkClient } from "@clerk/clerk-sdk-node";
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

export interface ClerkClaims {
  sub: string;
  email: string;
}

export async function verifyClerkToken(token: string): Promise<ClerkClaims> {
  try {
    const clerk = getClerk();
    const payload = await clerk.verifyToken(token, {
      jwtKey: env.CLERK_JWT_PUBLIC_KEY || undefined,
    });
    const email =
      (payload as any).email ??
      (payload as any).email_address ??
      `${payload.sub}@clerk`;
    return { sub: payload.sub, email };
  } catch (err) {
    logger.warn("clerk token verification failed", {
      error: (err as Error).message,
    });
    throw err;
  }
}
