-- ================================================================
-- Rezovo -- UI-specific tables (users, contacts, follow-ups, etc.)
-- Run AFTER setup_complete.sql. Idempotent (safe to re-run).
-- ================================================================

-- ================================================================
-- 1. USERS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES public.tenants(id),
  email       TEXT NOT NULL UNIQUE,
  roles       TEXT[] DEFAULT '{viewer}',
  clerk_id    TEXT UNIQUE,
  name        TEXT,
  status      TEXT DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_tenant   ON public.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON public.users(clerk_id);
CREATE INDEX IF NOT EXISTS idx_users_email    ON public.users(email);

-- ================================================================
-- 2. CONTACTS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.contacts (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES public.tenants(id),
  name              TEXT,
  phone             TEXT NOT NULL,
  email             TEXT,
  tags              TEXT[] DEFAULT '{}',
  sms_opt_out       BOOLEAN DEFAULT false,
  last_contacted_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON public.contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone  ON public.contacts(phone);

-- ================================================================
-- 3. FOLLOW-UPS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.follow_ups (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES public.tenants(id),
  contact_id            UUID REFERENCES public.contacts(id),
  call_id               TEXT REFERENCES public.calls(call_id),
  type                  TEXT NOT NULL CHECK (type IN (
                          'missed_call','booking','estimate_approval','ready_pickup',
                          'payment_pending','large_party','catering','complaint',
                          'reservation','order_issue','general'
                        )),
  status                TEXT DEFAULT 'open' CHECK (status IN (
                          'open','in_progress','waiting_on_customer','scheduled',
                          'snoozed','done','failed','canceled'
                        )),
  priority              INT DEFAULT 1,
  severity              TEXT DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  owner_id              TEXT,
  due_at                TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  recommended_next_step TEXT,
  channel_plan          JSONB DEFAULT '{}',
  attempts              JSONB DEFAULT '[]',
  scheduled_steps       JSONB DEFAULT '[]',
  metadata              JSONB DEFAULT '{}',
  vertical              TEXT DEFAULT 'Common',
  notes                 TEXT,
  tags                  TEXT[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_tenant  ON public.follow_ups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status  ON public.follow_ups(status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_contact ON public.follow_ups(contact_id);

-- ================================================================
-- 4. WORKFLOWS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.workflows (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id              TEXT NOT NULL REFERENCES public.tenants(id),
  vertical               TEXT,
  name                   TEXT,
  enabled                BOOLEAN DEFAULT true,
  trigger_key            TEXT,
  conditions             JSONB DEFAULT '{}',
  steps                  JSONB DEFAULT '[]',
  attempt_budget         JSONB DEFAULT '{}',
  escalation_rules       JSONB DEFAULT '[]',
  sla_minutes            INT,
  default_owner_strategy TEXT DEFAULT 'unassigned',
  is_built_in            BOOLEAN DEFAULT false,
  created_at             TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_tenant ON public.workflows(tenant_id);

-- ================================================================
-- 5. TEMPLATES
-- ================================================================
CREATE TABLE IF NOT EXISTS public.templates (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES public.tenants(id),
  vertical           TEXT,
  type               TEXT,
  title              TEXT,
  sms_template       TEXT,
  email_template     TEXT,
  quick_replies      TEXT[],
  tokens             TEXT[],
  checklist          TEXT[],
  default_next_steps TEXT[],
  links              JSONB DEFAULT '{}',
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_templates_tenant ON public.templates(tenant_id);

-- ================================================================
-- 6. NOTIFICATIONS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES public.tenants(id),
  type        TEXT DEFAULT 'info' CHECK (type IN ('info','success','warning','error')),
  title       TEXT,
  message     TEXT,
  read        BOOLEAN DEFAULT false,
  timestamp   TIMESTAMPTZ DEFAULT now(),
  action_url  TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON public.notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read   ON public.notifications(read) WHERE read = false;

-- ================================================================
-- 7. API KEYS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.api_keys (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES public.tenants(id),
  name         TEXT,
  prefix       TEXT,
  key_hash     TEXT,
  status       TEXT DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at   TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON public.api_keys(tenant_id);

-- ================================================================
-- SEED DATA
-- ================================================================

INSERT INTO public.users (id, tenant_id, email, roles, name, status)
VALUES ('user-admin', 'org_localdemo', 'admin@example.com', '{admin}', 'Admin User', 'active')
ON CONFLICT (email) DO UPDATE SET
  roles = '{admin}',
  tenant_id = 'org_localdemo';
