/**
 * Clerk JWT template contract for platform-api (session token template, e.g. name `platform-api`).
 *
 * Required claims (verified by Clerk SDK + our checks):
 * - `sub` — Clerk user id (`user_...`)
 * - `email` — add via template: {{user.primary_email_address}}
 *
 * Strongly recommended for tenant consistency:
 * - `org_id` — active organization id (`org_...`) when using Organizations
 * - `tenant_id` — optional custom claim, e.g. {{org.public_metadata.tenant_id}} or static test value;
 *   backend compares to `users.tenant_id` after DB resolution (must match if present).
 *
 * @see docs/AUTH_CLERK.md
 */
export type ClerkSessionClaimsShape = {
  sub: string;
  email?: string;
  org_id?: string;
  tenant_id?: string;
};
