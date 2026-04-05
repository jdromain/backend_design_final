/**
 * Set `CLERK_ENABLED=true|false` in `.env.local`. Only explicit `false` disables
 * Clerk (middleware, provider, token bridge, UserButton). Unset preserves prior
 * behavior (Clerk on when publishable key is present).
 */
export function isClerkFeatureOn(): boolean {
  const v = process.env.CLERK_ENABLED?.trim().toLowerCase();
  return v !== "false";
}

export function getClerkPublishableKey(): string {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
}

export function isClerkConfigured(): boolean {
  return isClerkFeatureOn() && Boolean(getClerkPublishableKey());
}
