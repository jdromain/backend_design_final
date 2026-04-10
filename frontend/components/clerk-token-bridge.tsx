"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { clearAuthToken, configureApiAuth } from "@/lib/api-client";
import { isClerkConfigured } from "@/lib/clerk-runtime";

const jwtTemplate = process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE ?? "platform-api";

function ClerkTokenBridgeInner() {
  const { isLoaded, isSignedIn, getToken } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      clearAuthToken();
      configureApiAuth(async () => {
        // Prefer the custom template (includes org_id / org_id claims).
        // Fall back to the default session token so auth works even before
        // the JWT template is created in the Clerk Dashboard.
        try {
          const custom = await getToken({ template: jwtTemplate });
          if (custom) return custom;
        } catch {
          /* template may not exist yet — use default */
        }
        return getToken();
      });
    } else {
      configureApiAuth(null);
    }
  }, [isLoaded, isSignedIn, getToken]);

  return null;
}

/**
 * Wires Clerk session JWT into `lib/api-client` fetch. Only mounts when Clerk is
 * configured so `useAuth` is never used without `ClerkProvider`.
 */
export function ClerkTokenBridge() {
  if (!isClerkConfigured()) return null;
  return <ClerkTokenBridgeInner />;
}
