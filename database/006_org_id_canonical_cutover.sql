BEGIN;

CREATE TEMP TABLE org_rekey_map (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL UNIQUE
) ON COMMIT DROP;

DO $$
DECLARE
  has_tenants BOOLEAN;
  has_organizations BOOLEAN;
  has_clerk_org_col BOOLEAN;
BEGIN
  SELECT to_regclass('public.tenants') IS NOT NULL INTO has_tenants;
  SELECT to_regclass('public.organizations') IS NOT NULL INTO has_organizations;

  IF has_tenants AND has_organizations THEN
    RAISE EXCEPTION 'both public.tenants and public.organizations exist; aborting';
  END IF;

  IF has_tenants THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tenants'
        AND column_name = 'clerk_organization_id'
    ) INTO has_clerk_org_col;

    IF has_clerk_org_col THEN
      IF EXISTS (
        SELECT 1
        FROM public.tenants
        WHERE status = 'active'
          AND id !~ '^org_[A-Za-z0-9]+$'
          AND (clerk_organization_id IS NULL OR btrim(clerk_organization_id) = '')
      ) THEN
        RAISE EXCEPTION 'active tenant missing clerk_organization_id for org-id rekey';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.tenants
        WHERE status = 'active'
          AND clerk_organization_id IS NOT NULL
          AND clerk_organization_id !~ '^org_[A-Za-z0-9]+$'
      ) THEN
        RAISE EXCEPTION 'active tenant has malformed clerk_organization_id (expected org_...)';
      END IF;

      IF EXISTS (
        SELECT clerk_organization_id
        FROM public.tenants
        WHERE clerk_organization_id IS NOT NULL
        GROUP BY clerk_organization_id
        HAVING COUNT(*) > 1
      ) THEN
        RAISE EXCEPTION 'duplicate clerk_organization_id values found';
      END IF;

      INSERT INTO org_rekey_map (old_id, new_id)
      SELECT id, clerk_organization_id
      FROM public.tenants
      WHERE id !~ '^org_[A-Za-z0-9]+$'
        AND clerk_organization_id IS NOT NULL
        AND btrim(clerk_organization_id) <> ''
        AND id <> clerk_organization_id
      ON CONFLICT (old_id) DO NOTHING;
    ELSE
      IF EXISTS (
        SELECT 1
        FROM public.tenants
        WHERE status = 'active'
          AND id !~ '^org_[A-Za-z0-9]+$'
      ) THEN
        RAISE EXCEPTION 'active tenant id is not org_* and no clerk_organization_id column exists';
      END IF;
    END IF;
  ELSIF has_organizations THEN
    IF EXISTS (
      SELECT 1
      FROM public.organizations
      WHERE status = 'active'
        AND id !~ '^org_[A-Za-z0-9]+$'
    ) THEN
      RAISE EXCEPTION 'active organization id is not org_*';
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_tenants_clerk_organization_id;

DO $$
DECLARE
  has_tenants BOOLEAN;
BEGIN
  SELECT to_regclass('public.tenants') IS NOT NULL INTO has_tenants;
  IF NOT has_tenants THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM org_rekey_map) THEN
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
      m.new_id,
      t.name,
      t.business_id,
      t.business_name,
      t.email,
      t.phone,
      t.plan_id,
      t.timezone,
      t.settings,
      t.metadata,
      m.new_id,
      t.status,
      t.created_at,
      t.updated_at
    FROM public.tenants t
    JOIN org_rekey_map m ON m.old_id = t.id
    LEFT JOIN public.tenants existing ON existing.id = m.new_id
    WHERE existing.id IS NULL
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      business_id = COALESCE(NULLIF(public.tenants.business_id, ''), EXCLUDED.business_id),
      business_name = COALESCE(NULLIF(public.tenants.business_name, ''), EXCLUDED.business_name),
      email = COALESCE(public.tenants.email, EXCLUDED.email),
      phone = COALESCE(public.tenants.phone, EXCLUDED.phone),
      plan_id = COALESCE(public.tenants.plan_id, EXCLUDED.plan_id),
      timezone = COALESCE(public.tenants.timezone, EXCLUDED.timezone),
      settings = COALESCE(public.tenants.settings, '{}'::jsonb) || EXCLUDED.settings,
      metadata = COALESCE(public.tenants.metadata, '{}'::jsonb) || EXCLUDED.metadata,
      clerk_organization_id = EXCLUDED.clerk_organization_id,
      status = EXCLUDED.status,
      updated_at = now();

    PERFORM 1;
  END IF;
END $$;

DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'tenant_id'
  LOOP
    EXECUTE format(
      'UPDATE public.%I target SET tenant_id = map.new_id FROM org_rekey_map map WHERE target.tenant_id = map.old_id',
      tbl.table_name
    );
  END LOOP;
END $$;

DO $$
DECLARE
  has_tenants BOOLEAN;
BEGIN
  SELECT to_regclass('public.tenants') IS NOT NULL INTO has_tenants;
  IF NOT has_tenants THEN
    RETURN;
  END IF;

  DELETE FROM public.tenants t
  USING org_rekey_map map
  WHERE t.id = map.old_id;

  ALTER TABLE public.tenants RENAME TO organizations;
END $$;

DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'tenant_id'
  LOOP
    EXECUTE format('ALTER TABLE public.%I RENAME COLUMN tenant_id TO org_id', tbl.table_name);
  END LOOP;
END $$;

DO $$
DECLARE
  idx RECORD;
  renamed TEXT;
BEGIN
  FOR idx IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname LIKE '%tenant%'
  LOOP
    renamed := replace(idx.indexname, 'tenant', 'org');
    IF to_regclass('public.' || renamed) IS NULL THEN
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', idx.indexname, renamed);
    END IF;
  END LOOP;

  FOR idx IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname LIKE '%tenants%'
  LOOP
    renamed := replace(idx.indexname, 'tenants', 'organizations');
    IF to_regclass('public.' || renamed) IS NULL THEN
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', idx.indexname, renamed);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.organizations DROP COLUMN IF EXISTS clerk_organization_id;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_clerk_id_key;
DROP INDEX IF EXISTS public.idx_users_clerk_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_email_unique ON public.users(org_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_clerk_unique
  ON public.users(org_id, clerk_id)
  WHERE clerk_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.call_transcript ct
    LEFT JOIN public.organizations o ON o.id = ct.org_id
    WHERE o.id IS NULL
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'call_transcript contains org_id values not present in organizations';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.call_events ce
    LEFT JOIN public.organizations o ON o.id = ce.org_id
    WHERE o.id IS NULL
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'call_events contains org_id values not present in organizations';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.kb_chunks kc
    LEFT JOIN public.organizations o ON o.id = kc.org_id
    WHERE o.id IS NULL
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'kb_chunks contains org_id values not present in organizations';
  END IF;
END $$;

ALTER TABLE public.call_transcript
  DROP CONSTRAINT IF EXISTS call_transcript_org_id_fkey,
  ADD CONSTRAINT call_transcript_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id);

ALTER TABLE public.call_events
  DROP CONSTRAINT IF EXISTS call_events_org_id_fkey,
  ADD CONSTRAINT call_events_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id);

ALTER TABLE public.kb_chunks
  DROP CONSTRAINT IF EXISTS kb_chunks_org_id_fkey,
  ADD CONSTRAINT kb_chunks_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id);

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_active_org_id_format;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_active_org_id_format
  CHECK (status <> 'active' OR id ~ '^org_[A-Za-z0-9]+$');

DROP FUNCTION IF EXISTS public.match_kb_chunks(vector(1536), text, text, integer, double precision);

CREATE OR REPLACE FUNCTION public.match_kb_chunks(
  query_embedding vector(1536),
  match_org_id TEXT,
  match_namespace TEXT,
  match_count INT DEFAULT 5,
  match_threshold FLOAT DEFAULT 0.5
)
RETURNS TABLE (
  id UUID,
  doc_id TEXT,
  chunk_index INT,
  text TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.doc_id,
    kc.chunk_index,
    kc.text,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.kb_chunks kc
  WHERE kc.org_id = match_org_id
    AND kc.namespace = match_namespace
    AND kc.embedding IS NOT NULL
    AND 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

COMMIT;
