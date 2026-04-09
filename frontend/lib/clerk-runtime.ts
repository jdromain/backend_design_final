/**
 * Clerk is active only when explicitly enabled **and** the publishable key is set.
 * Use `CLERK_ENABLED=true` and/or `NEXT_PUBLIC_CLERK_ENABLED=true` (see next.config).
 * Implicit "key present = Clerk on" is intentionally not supported — avoids half-enabled mode.
 */
function readHtmlFlag(attr: "data-clerk-enabled" | "data-clerk-configured"): boolean | null {
  if (typeof document === "undefined") return null;
  const raw = document.documentElement.getAttribute(attr);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

export function clerkExplicitlyEnabled(): boolean {
  // Browser should trust the server-rendered decision so we do not depend on
  // compile-time NEXT_PUBLIC_* replacements in the client bundle.
  const htmlFlag = readHtmlFlag("data-clerk-enabled");
  if (htmlFlag !== null) return htmlFlag;

  // Prefer runtime server vars that come from env_file in Docker Compose.
  const authMode = process.env.AUTH_MODE?.trim().toLowerCase();
  if (authMode === "clerk") return true;
  if (authMode === "dev_jwt") return false;

  const clerkAuthEnabled = process.env.CLERK_AUTH_ENABLED?.trim().toLowerCase();
  if (clerkAuthEnabled === "true") return true;
  if (clerkAuthEnabled === "false") return false;

  // Back-compat fallback (older env wiring).
  const a = process.env.NEXT_PUBLIC_CLERK_ENABLED?.trim().toLowerCase();
  const b = process.env.CLERK_ENABLED?.trim().toLowerCase();
  return a === "true" || b === "true";
}

export function getClerkPublishableKey(): string {
  return (
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ||
    process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}

/** Clerk UI + middleware + token bridge are active. */
export function isClerkConfigured(): boolean {
  const htmlFlag = readHtmlFlag("data-clerk-configured");
  if (htmlFlag !== null) return htmlFlag;
  return clerkExplicitlyEnabled() && Boolean(getClerkPublishableKey());
}

/** @deprecated Use isClerkConfigured() — single predicate for "Clerk mode". */
export function isClerkFeatureOn(): boolean {
  return isClerkConfigured();
}

/** Browser: API calls must not append `tenantId` for auth (platform-api uses Bearer only). */
export function isBrowserClerkApiMode(): boolean {
  if (typeof window === "undefined") return false;
  return isClerkConfigured();
}
