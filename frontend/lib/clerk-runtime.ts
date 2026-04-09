function readHtmlFlag(attr: "data-clerk-enabled" | "data-clerk-configured"): boolean | null {
  if (typeof document === "undefined") return null;
  const raw = document.documentElement.getAttribute(attr);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

export function clerkExplicitlyEnabled(): boolean {
  const htmlFlag = readHtmlFlag("data-clerk-enabled");
  if (htmlFlag !== null) return htmlFlag;

  const explicit =
    process.env.CLERK_AUTH_ENABLED?.trim().toLowerCase() ??
    process.env.NEXT_PUBLIC_CLERK_ENABLED?.trim().toLowerCase() ??
    process.env.CLERK_ENABLED?.trim().toLowerCase();

  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return true;
}

export function getClerkPublishableKey(): string {
  return (
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ||
    process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}

export function isClerkConfigured(): boolean {
  const htmlFlag = readHtmlFlag("data-clerk-configured");
  if (htmlFlag !== null) return htmlFlag;
  return clerkExplicitlyEnabled() && Boolean(getClerkPublishableKey());
}

/** Browser: API calls must not append `tenantId` for auth (platform-api uses Bearer only). */
export function isBrowserClerkApiMode(): boolean {
  if (typeof window === "undefined") return false;
  return isClerkConfigured();
}
