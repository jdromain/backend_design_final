/**
 * Clerk is active only when explicitly enabled **and** the publishable key is set.
 * Use `CLERK_ENABLED=true` and/or `NEXT_PUBLIC_CLERK_ENABLED=true` (see next.config).
 * Implicit "key present = Clerk on" is intentionally not supported — avoids half-enabled mode.
 */
export function clerkExplicitlyEnabled(): boolean {
  const a = process.env.NEXT_PUBLIC_CLERK_ENABLED?.trim().toLowerCase();
  const b = process.env.CLERK_ENABLED?.trim().toLowerCase();
  return a === "true" || b === "true";
}

export function getClerkPublishableKey(): string {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
}

/** Clerk UI + middleware + token bridge are active. */
export function isClerkConfigured(): boolean {
  return clerkExplicitlyEnabled() && Boolean(getClerkPublishableKey());
}

/** @deprecated Use isClerkConfigured() — single predicate for "Clerk mode". */
export function isClerkFeatureOn(): boolean {
  return isClerkConfigured();
}

/** Browser: API calls must not append `tenantId` for auth (platform-api uses Bearer only). */
export function isBrowserClerkApiMode(): boolean {
  if (typeof window === "undefined") return false;
  return process.env.NEXT_PUBLIC_CLERK_ENABLED === "true" && Boolean(getClerkPublishableKey());
}
