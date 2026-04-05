-- Clerk org → tenant mapping (idempotent). Run after setup_complete.sql.
-- Maps Clerk Organization ID (org_...) to existing tenant PK (e.g. test-tenant).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS clerk_organization_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_clerk_organization_id
  ON public.tenants (clerk_organization_id)
  WHERE clerk_organization_id IS NOT NULL;

COMMENT ON COLUMN public.tenants.clerk_organization_id IS
  'Clerk Organization ID for this tenant; set via webhook (org metadata) or manually for testing.';
