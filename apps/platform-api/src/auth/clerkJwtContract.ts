/**
 * Clerk JWT template contract for platform-api (session token template, e.g. name `platform-api`).
 *
 * Required claims (verified by Clerk SDK + our checks):
 * - `sub` — Clerk user id (`user_...`)
 * - `email` — add via template: {{user.primary_email_address}}
 *
 * Strongly recommended for tenant consistency:
 * - `org_id` — active organization id (`org_...`) when using Organizations
 * - `tenant_id` — optional custom claim; when present it should equal `org_id`.
 *   backend compares claim/org/user tenant and rejects mismatches.
 *
 * @see docs/AUTH_CLERK.md
 */
export type ClerkSessionClaimsShape = {
  sub: string;
  email?: string;
  org_id?: string;
  tenant_id?: string;
};
