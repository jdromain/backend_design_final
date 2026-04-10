/**
 * Clerk JWT template contract for platform-api (session token template, e.g. name `platform-api`).
 *
 * Required claims (verified by Clerk SDK + our checks):
 * - `sub` — Clerk user id (`user_...`)
 * - `email` — add via template: {{user.primary_email_address}}
 *
 * Required for org scoping:
 * - `org_id` — active organization id (`org_...`) when using Organizations
 *
 * @see docs/AUTH_CLERK.md
 */
export type ClerkSessionClaimsShape = {
  sub: string;
  email?: string;
  org_id?: string;
};
