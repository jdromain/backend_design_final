-- One-shot tenant primary-key rekey:
-- Migrate tenant identity from legacy IDs (e.g. test-tenant) to Clerk org IDs (org_...).
-- This script is transactional and fails fast on unsafe preconditions.

BEGIN;

LOCK TABLE public.tenants IN SHARE ROW EXCLUSIVE MODE;

-- Auto-heal already rekeyed rows that are missing clerk_organization_id.
UPDATE public.tenants
SET clerk_organization_id = id,
    updated_at = now()
WHERE status = 'active'
  AND clerk_organization_id IS NULL
  AND id ~ '^org_[A-Za-z0-9]+$';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tenants
    WHERE status = 'active'
      AND (clerk_organization_id IS NULL OR btrim(clerk_organization_id) = '')
  ) THEN
    RAISE EXCEPTION 'active tenant missing clerk_organization_id; link all active tenants before rekey';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenants
    WHERE status = 'active'
      AND clerk_organization_id !~ '^org_[A-Za-z0-9]+$'
  ) THEN
    RAISE EXCEPTION 'active tenant has malformed clerk_organization_id (expected org_...)';
  END IF;

  IF EXISTS (
    SELECT clerk_organization_id
    FROM public.tenants
    WHERE status = 'active'
    GROUP BY clerk_organization_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate clerk_organization_id values found for active tenants';
  END IF;
END $$;

CREATE TEMP TABLE tenant_rekey_map ON COMMIT DROP AS
SELECT
  id AS old_tenant_id,
  clerk_organization_id AS new_tenant_id
FROM public.tenants
WHERE status = 'active'
  AND id <> clerk_organization_id;

-- Create/merge shadow tenant rows keyed by org id.
INSERT INTO public.tenants (
  id,
  name,
  business_id,
  business_name,
  email,
  phone,
  plan_id,
  timezone,
  settings,
  metadata,
  clerk_organization_id,
  status,
  created_at,
  updated_at
)
SELECT
  m.new_tenant_id,
  t.name,
  COALESCE(NULLIF(t.business_id, ''), 'business-' || m.new_tenant_id),
  t.business_name,
  t.email,
  t.phone,
  t.plan_id,
  t.timezone,
  t.settings,
  t.metadata,
  NULL,
  t.status,
  t.created_at,
  now()
FROM public.tenants t
JOIN tenant_rekey_map m ON m.old_tenant_id = t.id
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  business_id = COALESCE(NULLIF(public.tenants.business_id, ''), EXCLUDED.business_id),
  business_name = COALESCE(public.tenants.business_name, EXCLUDED.business_name),
  email = COALESCE(public.tenants.email, EXCLUDED.email),
  phone = COALESCE(public.tenants.phone, EXCLUDED.phone),
  plan_id = COALESCE(public.tenants.plan_id, EXCLUDED.plan_id),
  timezone = COALESCE(public.tenants.timezone, EXCLUDED.timezone),
  clerk_organization_id = COALESCE(public.tenants.clerk_organization_id, EXCLUDED.clerk_organization_id),
  status = EXCLUDED.status,
  updated_at = now();

UPDATE public.agent_configs ac
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE ac.tenant_id = m.old_tenant_id;

UPDATE public.phone_numbers pn
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE pn.tenant_id = m.old_tenant_id;

UPDATE public.plans p
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE p.tenant_id = m.old_tenant_id;

UPDATE public.kb_documents d
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE d.tenant_id = m.old_tenant_id;

UPDATE public.kb_chunks kc
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE kc.tenant_id = m.old_tenant_id;

UPDATE public.calls c
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE c.tenant_id = m.old_tenant_id;

UPDATE public.call_transcript ct
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE ct.tenant_id = m.old_tenant_id;

UPDATE public.call_events ce
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE ce.tenant_id = m.old_tenant_id;

UPDATE public.tool_results tr
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE tr.tenant_id = m.old_tenant_id;

UPDATE public.credentials c
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE c.tenant_id = m.old_tenant_id;

UPDATE public.usage_records ur
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE ur.tenant_id = m.old_tenant_id;

UPDATE public.users u
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE u.tenant_id = m.old_tenant_id;

UPDATE public.contacts c
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE c.tenant_id = m.old_tenant_id;

UPDATE public.follow_ups f
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE f.tenant_id = m.old_tenant_id;

UPDATE public.workflows w
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE w.tenant_id = m.old_tenant_id;

UPDATE public.templates t
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE t.tenant_id = m.old_tenant_id;

UPDATE public.notifications n
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE n.tenant_id = m.old_tenant_id;

UPDATE public.api_keys ak
SET tenant_id = m.new_tenant_id
FROM tenant_rekey_map m
WHERE ak.tenant_id = m.old_tenant_id;

DELETE FROM public.tenants t
USING tenant_rekey_map m
WHERE t.id = m.old_tenant_id;

-- Enforce canonical active-tenant org identity.
UPDATE public.tenants
SET clerk_organization_id = id,
    business_id = COALESCE(NULLIF(business_id, ''), 'business-' || id),
    updated_at = now()
WHERE status = 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_tenants_active_id_is_clerk_org'
      AND conrelid = 'public.tenants'::regclass
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT chk_tenants_active_id_is_clerk_org
      CHECK (status <> 'active' OR id ~ '^org_[A-Za-z0-9]+$')
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_tenants_active_clerk_matches_id'
      AND conrelid = 'public.tenants'::regclass
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT chk_tenants_active_clerk_matches_id
      CHECK (status <> 'active' OR clerk_organization_id = id)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.tenants VALIDATE CONSTRAINT chk_tenants_active_id_is_clerk_org;
ALTER TABLE public.tenants VALIDATE CONSTRAINT chk_tenants_active_clerk_matches_id;

COMMIT;
