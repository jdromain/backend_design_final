"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { clearAuthToken, configureApiAuth } from "@/lib/api-client";
import { isClerkConfigured } from "@/lib/clerk-runtime";

const jwtTemplate = process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE?.trim() || null;
let templateLookupDisabled = false;
let missingTemplateWarningDispatched = false;

function isTemplateNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeStatus = (error as { status?: unknown }).status;
  if (typeof maybeStatus === "number" && maybeStatus === 404) return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes("404");
}

function ClerkTokenBridgeInner() {
  const { isLoaded, isSignedIn, getToken } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      clearAuthToken();
      configureApiAuth(async () => {
        // Prefer the custom template when configured.
        // If template lookup 404s once, disable further template lookups to avoid
        // repeated failing network calls and fallback directly to default session tokens.
        if (jwtTemplate && !templateLookupDisabled) {
          try {
            const custom = await getToken({ template: jwtTemplate });
            if (custom) return custom;
          } catch (error) {
            if (isTemplateNotFound(error)) {
              templateLookupDisabled = true;
              if (typeof window !== "undefined" && !missingTemplateWarningDispatched) {
                missingTemplateWarningDispatched = true;
                window.dispatchEvent(
                  new CustomEvent("rezovo:clerk-template-missing", {
                    detail: { template: jwtTemplate ?? "platform-api" },
                  }),
                );
              }
            }
          }
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
