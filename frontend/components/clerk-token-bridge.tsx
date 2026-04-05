"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { configureApiAuth } from "@/lib/api-client";
import { isClerkConfigured } from "@/lib/clerk-runtime";

const jwtTemplate = process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE ?? "platform-api";

function ClerkTokenBridgeInner() {
  const { isLoaded, isSignedIn, getToken } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      configureApiAuth(() => getToken({ template: jwtTemplate }));
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
